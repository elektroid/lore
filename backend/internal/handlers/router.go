package handlers

import (
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"lore/internal/auth"
	"lore/internal/config"
	db "lore/internal/db"
	"lore/internal/ratelimit"
	"lore/internal/table"
	"lore/internal/web"
)

func NewRouter(database *sql.DB, uploadsDir, externalMaterialDir string, tokenService *auth.TokenService, cfg *config.Config) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RealIP)
	r.Use(corsMiddleware(cfg))
	r.Use(rateLimitMiddleware())
	// Apply auth and CSRF middleware to all requests
	// The middleware will skip public endpoints internally
	r.Use(auth.AuthMiddleware(tokenService, database))
	r.Use(auth.CSRFMiddleware(tokenService))

	// Serve uploaded files
	r.Handle("/uploads/*", http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadsDir))))
	// Serve external material (PDFs etc.) — files are not tracked in git
	r.Handle("/external-material/*", http.StripPrefix("/external-material/", http.FileServer(http.Dir(externalMaterialDir))))

	// Initialize auth handler
	authHandler := NewAuthHandler(database, tokenService, cfg)

	// Live table surface — one hub shared by the console, the projection screen
	// and every player seat. See docs/play-table.md.
	tableHandler := NewTableHandler(database, table.NewHub())

	// Table endpoints are public: the share token in the path is the credential,
	// because the projection screen is usually a TV nobody logs in on.
	r.Route("/api/table/{token}", func(r chi.Router) {
		r.Get("/", tableHandler.Snapshot)
		r.Get("/stream", tableHandler.Stream)
		r.Post("/rolls", tableHandler.PlayerRoll)
	})

	// Auth endpoints (public - no auth middleware)
	r.Route("/api/auth", func(r chi.Router) {
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/logout", authHandler.Logout)
		r.Get("/me", authHandler.Me)
		r.Put("/me", authHandler.UpdateMe)
		r.Post("/refresh", authHandler.Refresh)
		r.Get("/csrf", authHandler.CSRF)
		r.Post("/bootstrap", authHandler.Bootstrap)
	})

	r.Route("/api", func(r chi.Router) {
		// User endpoints
		users := &UserHandler{db: database}
		r.Route("/users", func(r chi.Router) {
			r.Get("/", users.List)
			r.Put("/{id}/role", users.UpdateRole)
		})

		// Character endpoints
		characters := &CharacterHandler{db: database}
		r.Route("/characters", func(r chi.Router) {
			r.Get("/", characters.List)
			r.Post("/", characters.Create)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", characters.Get)
				r.Put("/", characters.Update)
				r.Delete("/", characters.Delete)
			})
		})

		settings := &SettingsHandler{db: database, encKey: cfg.EncryptionKey()}
		r.Route("/settings", func(r chi.Router) {
			// Reads are open: the app shows whether an LLM is configured, and
			// the key is masked on the way out. Writes are instance-wide.
			r.Get("/llm", settings.GetLLM)
			r.Get("/mistral", settings.GetMistral)
			r.With(requireSuperuser).Put("/llm", settings.PutLLM)
			r.With(requireSuperuser).Put("/mistral", settings.PutMistral)
		})

		games := &GameHandler{db: database, externalMaterialDir: externalMaterialDir}
		gameLLM := &GameLLMHandler{db: database, encKey: cfg.EncryptionKey()}
		r.Route("/games", func(r chi.Router) {
			// The game catalogue is shared by every campaign in the instance, so
			// reading is open to all and editing is the administrator's.
			// One Route("/{id}") only — chi panics on a duplicate pattern, so the
			// guard goes on the individual verbs rather than a nested group.
			r.Get("/", games.List)
			r.With(requireSuperuser).Post("/", games.Create)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", games.Get)
				r.Get("/documents", games.ListDocuments)
				r.With(requireSuperuser).Put("/", games.Update)
				r.With(requireSuperuser).Delete("/", games.Delete)
				r.With(requireSuperuser).Put("/visual-style", games.UpdateVisualStyle)
				r.With(requireSuperuser).Post("/llm/generate-visual-style", gameLLM.GenerateVisualStyle)
			})
		})

		campaigns := &CampaignHandler{db: database}
		runs := &RunHandler{db: database}
		entities := &EntityHandler{db: database, encKey: cfg.EncryptionKey()}
		uploads := &UploadsHandler{db: database, uploadsDir: uploadsDir}
		imageLLM := &ImageLLMHandler{
			db:         database,
			uploadsDir: uploadsDir,
			encKey:     cfg.EncryptionKey(),
		}
		scenarioFactory := &ScenarioFactoryHandler{db: database, encKey: cfg.EncryptionKey()}
		r.Route("/campaigns", func(r chi.Router) {
			r.Get("/", campaigns.List)
			r.Post("/", campaigns.Create)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", campaigns.Get)
				r.Put("/", campaigns.Update)
				r.Delete("/", campaigns.Delete)
				r.Get("/export", campaigns.Export)

				// Campaign membership endpoints
				r.Route("/members", func(r chi.Router) {
					r.Get("/", campaigns.ListMembers)
					r.Post("/", campaigns.AddMember)
					r.Delete("/{userId}", campaigns.RemoveMember)
					r.Get("/characters", campaigns.ListMemberCharacters)
				})

				// All entity and content routes require campaign ownership
				r.Group(func(r chi.Router) {
					r.Use(requireCampaignOwner(database))
					r.Get("/search", entities.Search)

					// Groups playing this campaign, and their parties. The
					// campaign is authored once and played by several of them.
					// See docs/adr/0001-runs-separate-story-from-play.md.
					r.Route("/runs", func(r chi.Router) {
						r.Get("/", runs.List)
						r.Post("/", runs.Create)
						r.Route("/{runId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "runId", db.TableRuns, db.ColCampaignID))
							r.Get("/", runs.Get)
							r.Put("/", runs.Update)
							r.Delete("/", runs.Delete)
							r.Get("/players", runs.ListPlayers)
							r.Put("/players/{userId}", runs.SetPlayer)
							r.Delete("/players/{userId}", runs.RemovePlayer)
						})
					})

					// Scenario factory — see docs/scenario-factory.md
					r.Route("/scenario-drafts", func(r chi.Router) {
						r.Get("/", scenarioFactory.List)
						r.Post("/", scenarioFactory.Create)
					})
					r.Route("/npcs", func(r chi.Router) {
						r.Get("/", entities.ListNPCs)
						r.Post("/", entities.CreateNPC)
						r.Route("/{npcId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "npcId", db.TableNPCs, db.ColCampaignID))
							r.Get("/", entities.GetNPC)
							r.Put("/", entities.UpdateNPC)
							r.Delete("/", entities.DeleteNPC)
							r.Post("/llm/develop", entities.DevelopNPCSuggestion)
							r.Post("/llm/generate-images", imageLLM.GenerateNPCImages)
							r.Post("/llm/confirm-images", imageLLM.ConfirmNPCImages)
							r.Post("/images", uploads.UploadNPCImage)
							r.Delete("/images/{imageId}", uploads.DeleteNPCImage)
						})
					})
					r.Route("/locations", func(r chi.Router) {
						r.Get("/", entities.ListLocations)
						r.Post("/", entities.CreateLocation)
						r.Route("/{locationId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "locationId", db.TableLocations, db.ColCampaignID))
							r.Get("/", entities.GetLocation)
							r.Put("/", entities.UpdateLocation)
							r.Delete("/", entities.DeleteLocation)
							r.Post("/llm/develop", entities.DevelopLocation)
							r.Post("/llm/generate-images", imageLLM.GenerateLocationImages)
							r.Post("/llm/confirm-images", imageLLM.ConfirmLocationImages)
							r.Post("/images", uploads.UploadLocationImage)
							r.Put("/images/{imageId}", uploads.UpdateImageMeta)
							r.Delete("/images/{imageId}", uploads.DeleteLocationImage)
						})
					})
					r.Route("/factions", func(r chi.Router) {
						r.Get("/", entities.ListFactions)
						r.Post("/", entities.CreateFaction)
						r.Route("/{factionId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "factionId", db.TableFactions, db.ColCampaignID))
							r.Get("/", entities.GetFaction)
							r.Put("/", entities.UpdateFaction)
							r.Delete("/", entities.DeleteFaction)
							r.Post("/llm/develop", entities.DevelopFaction)
							r.Post("/llm/generate-images", imageLLM.GenerateFactionImages)
							r.Post("/llm/confirm-images", imageLLM.ConfirmFactionImages)
							r.Post("/images", uploads.UploadFactionImage)
							r.Delete("/images/{imageId}", uploads.DeleteFactionImage)
						})
					})
					r.Route("/artefacts", func(r chi.Router) {
						r.Get("/", entities.ListArtefacts)
						r.Post("/", entities.CreateArtefact)
						r.Route("/{artefactId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "artefactId", db.TableArtefacts, db.ColCampaignID))
							r.Get("/", entities.GetArtefact)
							r.Put("/", entities.UpdateArtefact)
							r.Delete("/", entities.DeleteArtefact)
							r.Post("/llm/develop", imageLLM.DevelopArtefact)
							r.Post("/llm/generate-images", imageLLM.GenerateArtefactImages)
							r.Post("/llm/confirm-images", imageLLM.ConfirmArtefactImages)
							r.Post("/images", uploads.UploadArtefactImage)
							r.Delete("/images/{imageId}", uploads.DeleteArtefactImage)
							r.Route("/links", func(r chi.Router) {
								r.Get("/", entities.ListArtefactLinks)
								r.Post("/", entities.CreateArtefactLink)
								r.Delete("/{linkId}", entities.DeleteArtefactLink)
							})
						})
					})
				})
			})
			r.Route("/{campaignID}/scenarios", func(r chi.Router) {
				scenarios := &ScenarioHandler{db: database}
				r.Use(requireCampaignOwnerByParam(database, "campaignID"))
				r.Get("/", scenarios.List)
				r.Post("/", scenarios.Create)
			})
		})

		// Draft-scoped factory routes: the draft resolves to its campaign, so
		// they hang off the draft id rather than under /campaigns.
		r.Route("/scenario-drafts/{draftId}", func(r chi.Router) {
			r.Use(requireDraftOwner(database))
			r.Get("/", scenarioFactory.Get)
			r.Put("/", scenarioFactory.Update)
			r.Delete("/", scenarioFactory.Delete)
			r.Post("/regenerate", scenarioFactory.Regenerate)
			r.Post("/scenes/{sceneRef}/expand", scenarioFactory.ExpandScene)
			r.Post("/commit", scenarioFactory.Commit)
		})

		scenarios := &ScenarioHandler{db: database}
		synopsis := &SynopsisHandler{db: database, encKey: cfg.EncryptionKey()}
		brainstorm := &BrainstormHandler{db: database, encKey: cfg.EncryptionKey()}
		r.Route("/scenarios/{id}", func(r chi.Router) {
			r.Use(requireScenarioOwner(database))
			r.Get("/", scenarios.Get)
			r.Put("/", scenarios.Update)
			r.Delete("/", scenarios.Delete)
			r.Post("/duplicate", scenarios.Duplicate)

			r.Route("/synopsis", func(r chi.Router) {
				r.Get("/", synopsis.Get)
				r.Put("/", synopsis.Update)
				r.Get("/snapshots", synopsis.ListSnapshots)
				r.Post("/restore/{snapshotID}", synopsis.RestoreSnapshot)
				r.Get("/npcs", synopsis.ListNPCs)
				r.Post("/npcs", synopsis.AddNPC)
				r.Delete("/npcs/{npcId}", synopsis.RemoveNPC)
				r.Put("/npcs/{npcId}/status", synopsis.UpdateNPCStatus)
				r.Get("/factions", synopsis.ListFactions)
				r.Post("/factions", synopsis.AddFaction)
				r.Delete("/factions/{factionId}", synopsis.RemoveFaction)
				r.Route("/scenes", func(r chi.Router) {
					r.Get("/", synopsis.ListScenes)
					r.Post("/", synopsis.CreateScene)
					r.Post("/reorder", synopsis.ReorderScenes)
					r.Route("/{sceneId}", func(r chi.Router) {
						r.Use(requireChild(database, "id", "sceneId", db.TableScenes, db.ColScenarioID))
						r.Put("/", synopsis.UpdateScene)
						r.Delete("/", synopsis.DeleteScene)
						r.Post("/npcs", synopsis.AddSceneNPC)
						r.Delete("/npcs/{npcId}", synopsis.RemoveSceneNPC)
						r.Post("/artefacts", synopsis.AddSceneArtefact)
						r.Delete("/artefacts/{artefactId}", synopsis.RemoveSceneArtefact)
						r.Post("/llm/develop", synopsis.DevelopScene)
					})
				})
				r.Route("/llm", func(r chi.Router) {
					r.Post("/complete-hook", synopsis.CompleteHook)
					r.Post("/suggest-npcs", synopsis.SuggestNPCs)
					r.Post("/develop-npc/{npcId}", synopsis.DevelopNPC)
					r.Post("/suggest-scene", synopsis.SuggestScene)
					r.Post("/generate-overview", synopsis.GenerateOverview)
				})
			})

			// How far one group has got in this scenario. Derived from that
			// group's sessions — see docs/adr/0001-runs-separate-story-from-play.md.
			r.Get("/runs/{runId}/scenes", synopsis.GetRunScenes)

			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", synopsis.ListSessions)
				r.Post("/", synopsis.CreateSession)
				r.Route("/{sessionId}", func(r chi.Router) {
					r.Use(requireChild(database, "id", "sessionId", db.TableSessions, db.ColScenarioID))
					r.Put("/", synopsis.UpdateSession)
					r.Delete("/", synopsis.DeleteSession)
					r.Get("/scenes", synopsis.GetSessionScenes)
					r.Put("/scenes/{sceneId}", synopsis.SetSessionSceneState)
					r.Delete("/scenes/{sceneId}", synopsis.ClearSessionSceneState)

					// Table surface, GM side
					r.Post("/table-token", tableHandler.EnsureToken)
					r.Put("/projection", tableHandler.SetProjection)
					r.Delete("/projection", tableHandler.ClearProjection)
					r.Get("/rolls", tableHandler.ListRolls)
					r.Post("/rolls", tableHandler.GMRoll)
				})
			})

			// Improvised beats — captured during play, developed and adopted
			// later. See docs/play-improv.md.
			r.Route("/beats", func(r chi.Router) {
				r.Get("/", synopsis.ListBeats)
				r.Post("/", synopsis.CreateBeat)
				r.Route("/{beatId}", func(r chi.Router) {
					r.Use(requireChild(database, "id", "beatId", db.TableBeats, db.ColScenarioID))
					r.Put("/", synopsis.UpdateBeat)
					r.Delete("/", synopsis.DeleteBeat)
					r.Post("/develop", synopsis.DevelopBeat)
					r.Post("/adopt", synopsis.AdoptBeat)
				})
			})

			r.Route("/brainstorm/threads", func(r chi.Router) {
				r.Get("/", brainstorm.ListThreads)
				r.Post("/", brainstorm.CreateThread)
				r.Route("/{threadId}", func(r chi.Router) {
					r.Use(requireChild(database, "id", "threadId", db.TableThreads, db.ColScenarioID))
					r.Put("/", brainstorm.RenameThread)
					r.Delete("/", brainstorm.DeleteThread)
					r.Get("/messages", brainstorm.GetMessages)
					r.Post("/messages", brainstorm.SendMessage)
				})
			})
		})
	})

	// The built frontend, when one is embedded. Registered last and only as a
	// catch-all: /api, /uploads and /external-material are matched first, so a
	// bad API path still returns JSON rather than the app shell.
	if assets, ok := web.Assets(); ok {
		r.Handle("/*", web.Handler(assets))
	}

	return r
}

func corsMiddleware(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Use configured origins, default to localhost:5173
			origins := cfg.CORS.Origins
			if len(origins) == 0 {
				origins = []string{"http://localhost:5173"}
			}

			w.Header().Set("Access-Control-Allow-Origin", strings.Join(origins, ", "))
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Disposition, X-CSRF-Token")
			w.Header().Set("Access-Control-Allow-Credentials", "true")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// Rate limits, per client IP.
//
// The strict bucket exists for the login and registration forms: an exposed
// instance would otherwise accept unlimited password guesses. The general
// bucket is deliberately roomy — a GM with the console, a projection screen and
// two player seats open is a normal amount of traffic, and locking them out
// mid-session would be a worse bug than the one being prevented.
//
// Note the IP comes from middleware.RealIP, which trusts X-Forwarded-For.
// That is correct behind a reverse proxy and spoofable without one; see
// docs/deployment.md.
const (
	authRateMax    = 10
	authRateWindow = 15 * time.Minute

	generalRateMax    = 600
	generalRateWindow = time.Minute
)

func rateLimitMiddleware() func(http.Handler) http.Handler {
	auth := ratelimit.New(authRateMax, authRateWindow)
	general := ratelimit.New(generalRateMax, generalRateWindow)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// The table stream is one long-lived connection, and uploads of a
			// large image should not count against a per-minute budget.
			if r.Method == http.MethodOptions || strings.HasSuffix(r.URL.Path, "/stream") {
				next.ServeHTTP(w, r)
				return
			}

			limiter, bucket := general, "requêtes"
			if isCredentialEndpoint(r) {
				limiter, bucket = auth, "tentatives de connexion"
			}

			ip := clientIP(r)
			if !limiter.Allow(ip) {
				retry := limiter.Retry(ip)
				w.Header().Set("Retry-After", strconv.Itoa(int(retry.Seconds())+1))
				writeError(w, http.StatusTooManyRequests,
					"trop de "+bucket+" — réessayez dans "+humanDuration(retry))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// isCredentialEndpoint marks the routes worth guessing at: anything that takes
// a password.
func isCredentialEndpoint(r *http.Request) bool {
	if r.Method != http.MethodPost {
		return false
	}
	switch r.URL.Path {
	case "/api/auth/login", "/api/auth/register", "/api/auth/bootstrap":
		return true
	}
	return false
}

func clientIP(r *http.Request) string {
	// RealIP has already normalised this when a proxy is present.
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

func humanDuration(d time.Duration) string {
	if d < time.Minute {
		return strconv.Itoa(int(d.Seconds())+1) + " s"
	}
	return strconv.Itoa(int(d.Minutes())+1) + " min"
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
