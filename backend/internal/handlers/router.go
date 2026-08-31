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

	// Public — the login page shows it too, see isPublicEndpoint.
	r.Get("/api/version", Version)

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
		r.Post("/forgot-password", authHandler.ForgotPassword)
		r.Post("/reset-password", authHandler.ResetPassword)
	})

	r.Route("/api", func(r chi.Router) {
		// User endpoints
		users := &UserHandler{db: database}
		r.Route("/users", func(r chi.Router) {
			r.Get("/", users.List)
			r.With(requireSuperuser).Post("/", users.Create)
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

		// Player mode: an authenticated player's own view of the runs they are
		// seated in, account-scoped only. See docs/adr/0001-runs-separate-story-from-play.md.
		me := &MeHandler{db: database}
		r.Route("/me/runs", func(r chi.Router) {
			r.Get("/", me.ListRuns)
			r.Route("/{runId}", func(r chi.Router) {
				r.Get("/", me.GetRun)
				r.Put("/character", me.SetCharacter)
				r.Get("/notes", me.GetNotes)
				r.Put("/notes", me.PutNotes)
			})
		})

		settings := &SettingsHandler{db: database, encKey: cfg.EncryptionKey()}
		serverInfo := &ServerInfoHandler{db: database, dbPath: cfg.Database.Path, uploadsDir: uploadsDir, externalMaterialDir: externalMaterialDir}
		r.Route("/settings", func(r chi.Router) {
			// Reads are open: the app shows whether an LLM is configured, and
			// the key is masked on the way out. Writes are instance-wide.
			r.Get("/llm", settings.GetLLM)
			r.Get("/images", settings.GetImageConfig)
			r.With(requireSuperuser).Put("/llm", settings.PutLLM)
			r.With(requireSuperuser).Put("/images", settings.PutImageConfig)
			r.With(requireSuperuser).Post("/llm/models", settings.ListLLMModels)
			// Disk space and process facts are operational detail, not secrets,
			// but there's no reason to expose them beyond the people who already
			// see the LLM keys on this page.
			r.With(requireSuperuser).Get("/server-info", serverInfo.GetServerInfo)
		})

		// Audit log: who logged in, promoted a user, or changed instance
		// config. See audit_log in schema.sql and docs/users-admin.md.
		audit := &AuditHandler{db: database}
		r.With(requireSuperuser).Get("/audit-log", audit.List)

		games := &GameHandler{db: database, externalMaterialDir: externalMaterialDir}
		gameLLM := &GameLLMHandler{db: database, encKey: cfg.EncryptionKey()}
		r.Route("/games", func(r chi.Router) {
			// The game catalogue is shared by every campaign in the instance, so
			// reading is open to all and editing is the administrator's.
			// One Route("/{id}") only — chi panics on a duplicate pattern, so the
			// guard goes on the individual verbs rather than a nested group.
			r.Get("/", games.List)
			r.With(requireSuperuser).Post("/", games.Create)
			// Import creates a new game from another instance's exported zip
			// (multipart upload, field "file") — an admin action, and a
			// literal segment so it doesn't collide with the /{id} route below.
			r.With(requireSuperuser).Post("/import", games.Import)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", games.Get)
				r.Get("/documents", games.ListDocuments)
				r.With(requireSuperuser).Post("/documents", games.UploadDocument)
				r.With(requireSuperuser).Delete("/documents/*", games.DeleteDocument)
				r.With(requireSuperuser).Put("/", games.Update)
				r.With(requireSuperuser).Delete("/", games.Delete)
				r.With(requireSuperuser).Put("/visual-style", games.UpdateVisualStyle)
				r.With(requireSuperuser).Post("/llm/generate-visual-style", gameLLM.GenerateVisualStyle)
				r.With(requireSuperuser).Get("/export", games.Export)
				r.Get("/lore-entities", games.ListLoreEntities)
				r.Get("/lore-entity-kinds", games.ListLoreEntityKinds)
				r.With(requireSuperuser).Post("/lore-entities", games.CreateLoreEntity)
				r.With(requireSuperuser).Delete("/lore-entities/{entityId}", games.DeleteLoreEntity)
				r.With(requireSuperuser).Patch("/lore-entities/{entityId}", games.UpdateLoreEntityKind)
				r.Get("/lore-entities/{entityId}", games.GetLoreEntity)
				r.Get("/lore-entities/{entityId}/relations", games.GetLoreEntityRelations)
				r.Get("/lore-relations", games.ListLoreRelations)
			})
		})

		sheetTemplates := &SheetTemplateHandler{db: database}
		r.Route("/sheet-templates", func(r chi.Router) {
			// Same split as /games: reading is needed by any character/NPC
			// editor to render a sheet, writing is the administrator's.
			r.Get("/", sheetTemplates.List)
			r.With(requireSuperuser).Post("/", sheetTemplates.Create)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", sheetTemplates.Get)
				r.With(requireSuperuser).Put("/", sheetTemplates.Update)
				r.With(requireSuperuser).Delete("/", sheetTemplates.Delete)
			})
		})

		campaigns := &CampaignHandler{db: database}
		archivedCampaigns := &ArchivedCampaignHandler{db: database}
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

				// Entity and content routes: reading and running a session
				// only need campaign access — the gamemaster delegation.
				// Authoring writes stay behind requireCampaignOwner, applied
				// per verb below, because campaign_members is not
				// co-authorship. See docs/adr/0001-runs-separate-story-from-play.md.
				r.Group(func(r chi.Router) {
					owner := requireCampaignOwner(database)
					r.Use(requireCampaignAccess(database))
					r.Get("/search", entities.Search)

					// Groups playing this campaign, and their parties. Any
					// delegated account manages runs freely — that is what
					// the delegation is for.
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

					// Scenario factory — authoring, owner-only. See docs/scenario-factory.md
					r.Route("/scenario-drafts", func(r chi.Router) {
						r.With(owner).Get("/", scenarioFactory.List)
						r.With(owner).Post("/", scenarioFactory.Create)
					})
					r.Route("/npcs", func(r chi.Router) {
						r.Get("/", entities.ListNPCs)
						r.With(owner).Post("/", entities.CreateNPC)
						r.Route("/{npcId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "npcId", db.TableNPCs, db.ColCampaignID))
							r.Get("/", entities.GetNPC)
							r.With(owner).Put("/", entities.UpdateNPC)
							r.With(owner).Delete("/", entities.DeleteNPC)
							r.With(owner).Post("/llm/develop", entities.DevelopNPCSuggestion)
							r.With(owner).Post("/llm/generate-images", imageLLM.GenerateNPCImages)
							r.With(owner).Post("/llm/confirm-images", imageLLM.ConfirmNPCImages)
							r.With(owner).Post("/images", uploads.UploadNPCImage)
							r.With(owner).Delete("/images/{imageId}", uploads.DeleteNPCImage)
						})
					})
					r.Route("/locations", func(r chi.Router) {
						r.Get("/", entities.ListLocations)
						r.With(owner).Post("/", entities.CreateLocation)
						r.Route("/{locationId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "locationId", db.TableLocations, db.ColCampaignID))
							r.Get("/", entities.GetLocation)
							r.With(owner).Put("/", entities.UpdateLocation)
							r.With(owner).Delete("/", entities.DeleteLocation)
							r.With(owner).Post("/llm/develop", entities.DevelopLocation)
							r.With(owner).Post("/llm/generate-images", imageLLM.GenerateLocationImages)
							r.With(owner).Post("/llm/confirm-images", imageLLM.ConfirmLocationImages)
							r.With(owner).Post("/images", uploads.UploadLocationImage)
							r.With(owner).Put("/images/{imageId}", uploads.UpdateImageMeta)
							r.With(owner).Delete("/images/{imageId}", uploads.DeleteLocationImage)
						})
					})
					r.Route("/factions", func(r chi.Router) {
						r.Get("/", entities.ListFactions)
						r.With(owner).Post("/", entities.CreateFaction)
						r.Route("/{factionId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "factionId", db.TableFactions, db.ColCampaignID))
							r.Get("/", entities.GetFaction)
							r.With(owner).Put("/", entities.UpdateFaction)
							r.With(owner).Delete("/", entities.DeleteFaction)
							r.With(owner).Post("/llm/develop", entities.DevelopFaction)
							r.With(owner).Post("/llm/generate-images", imageLLM.GenerateFactionImages)
							r.With(owner).Post("/llm/confirm-images", imageLLM.ConfirmFactionImages)
							r.With(owner).Post("/images", uploads.UploadFactionImage)
							r.With(owner).Delete("/images/{imageId}", uploads.DeleteFactionImage)
						})
					})
					r.Route("/artefacts", func(r chi.Router) {
						r.Get("/", entities.ListArtefacts)
						r.With(owner).Post("/", entities.CreateArtefact)
						r.Route("/{artefactId}", func(r chi.Router) {
							r.Use(requireChild(database, "id", "artefactId", db.TableArtefacts, db.ColCampaignID))
							r.Get("/", entities.GetArtefact)
							r.With(owner).Put("/", entities.UpdateArtefact)
							r.With(owner).Delete("/", entities.DeleteArtefact)
							r.With(owner).Post("/llm/develop", imageLLM.DevelopArtefact)
							r.With(owner).Post("/llm/generate-images", imageLLM.GenerateArtefactImages)
							r.With(owner).Post("/llm/confirm-images", imageLLM.ConfirmArtefactImages)
							r.With(owner).Post("/images", uploads.UploadArtefactImage)
							r.With(owner).Delete("/images/{imageId}", uploads.DeleteArtefactImage)
							r.Route("/links", func(r chi.Router) {
								r.Get("/", entities.ListArtefactLinks)
								r.With(owner).Post("/", entities.CreateArtefactLink)
								r.With(owner).Delete("/{linkId}", entities.DeleteArtefactLink)
							})
						})
					})
				})
			})
			r.Route("/{campaignID}/scenarios", func(r chi.Router) {
				scenarios := &ScenarioHandler{db: database}
				// Listing is how a delegated GM finds something to run
				// (GameMasterPage's quick-launch list); writing new scenario
				// content is authoring, owner-only.
				r.Use(requireCampaignAccessByParam(database, "campaignID"))
				r.Get("/", scenarios.List)
				r.With(requireCampaignOwnerByParam(database, "campaignID")).Post("/", scenarios.Create)
			})
		})

		r.Route("/archived-campaigns", func(r chi.Router) {
			r.Get("/", archivedCampaigns.List)
			r.Get("/{id}/export", archivedCampaigns.Export)
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
			// Reading the story and running a session (sessions, beats, the
			// table) only need campaign access — the gamemaster delegation.
			// Writing the story is authoring, and stays behind
			// requireScenarioOwner, applied per verb below.
			owner := requireScenarioOwner(database)
			r.Use(requireScenarioAccess(database))
			r.Get("/", scenarios.Get)
			r.With(owner).Put("/", scenarios.Update)
			r.With(owner).Delete("/", scenarios.Delete)
			r.With(owner).Post("/duplicate", scenarios.Duplicate)

			r.Route("/synopsis", func(r chi.Router) {
				r.Get("/", synopsis.Get)
				r.With(owner).Put("/", synopsis.Update)
				r.With(owner).Get("/snapshots", synopsis.ListSnapshots)
				r.With(owner).Post("/restore/{snapshotID}", synopsis.RestoreSnapshot)
				r.Get("/npcs", synopsis.ListNPCs)
				r.With(owner).Post("/npcs", synopsis.AddNPC)
				r.With(owner).Delete("/npcs/{npcId}", synopsis.RemoveNPC)
				r.With(owner).Put("/npcs/{npcId}/status", synopsis.UpdateNPCStatus)
				r.Get("/factions", synopsis.ListFactions)
				r.With(owner).Post("/factions", synopsis.AddFaction)
				r.With(owner).Delete("/factions/{factionId}", synopsis.RemoveFaction)
				r.Route("/scenes", func(r chi.Router) {
					r.Get("/", synopsis.ListScenes)
					r.With(owner).Post("/", synopsis.CreateScene)
					r.With(owner).Post("/reorder", synopsis.ReorderScenes)
					r.Route("/{sceneId}", func(r chi.Router) {
						r.Use(requireChild(database, "id", "sceneId", db.TableScenes, db.ColScenarioID))
						r.With(owner).Put("/", synopsis.UpdateScene)
						r.With(owner).Delete("/", synopsis.DeleteScene)
						r.With(owner).Post("/npcs", synopsis.AddSceneNPC)
						r.With(owner).Delete("/npcs/{npcId}", synopsis.RemoveSceneNPC)
						r.With(owner).Post("/artefacts", synopsis.AddSceneArtefact)
						r.With(owner).Delete("/artefacts/{artefactId}", synopsis.RemoveSceneArtefact)
						r.With(owner).Post("/llm/develop", synopsis.DevelopScene)
					})
				})
				r.Route("/llm", func(r chi.Router) {
					r.Use(owner)
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

			// Brainstorming is an authoring tool for developing the story —
			// owner-only, unlike the sessions/beats above it.
			r.Route("/brainstorm/threads", func(r chi.Router) {
				r.Use(owner)
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
	case "/api/auth/login", "/api/auth/register", "/api/auth/bootstrap",
		"/api/auth/forgot-password", "/api/auth/reset-password":
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
