package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"lore/internal/auth"
	"lore/internal/config"
	"lore/internal/table"
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

		settings := &SettingsHandler{db: database, encKey: cfg.JWT.Secret}
		r.Route("/settings", func(r chi.Router) {
			r.Get("/llm", settings.GetLLM)
			r.Put("/llm", settings.PutLLM)
			r.Get("/mistral", settings.GetMistral)
			r.Put("/mistral", settings.PutMistral)
		})

		games := &GameHandler{db: database, externalMaterialDir: externalMaterialDir}
		gameLLM := &GameLLMHandler{db: database, encKey: cfg.JWT.Secret}
		r.Route("/games", func(r chi.Router) {
			r.Get("/", games.List)
			r.Post("/", games.Create)
			r.Route("/{id}", func(r chi.Router) {
				r.Get("/", games.Get)
				r.Put("/", games.Update)
				r.Delete("/", games.Delete)
				r.Get("/documents", games.ListDocuments)
				r.Put("/visual-style", games.UpdateVisualStyle)
				r.Post("/llm/generate-visual-style", gameLLM.GenerateVisualStyle)
			})
		})

		campaigns := &CampaignHandler{db: database}
		entities := &EntityHandler{db: database, encKey: cfg.JWT.Secret}
		uploads := &UploadsHandler{db: database, uploadsDir: uploadsDir}
		imageLLM := &ImageLLMHandler{
			db:         database,
			uploadsDir: uploadsDir,
			encKey:     cfg.JWT.Secret,
		}
		scenarioFactory := &ScenarioFactoryHandler{db: database, encKey: cfg.JWT.Secret}
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

					// Scenario factory — see docs/scenario-factory.md
					r.Route("/scenario-drafts", func(r chi.Router) {
						r.Get("/", scenarioFactory.List)
						r.Post("/", scenarioFactory.Create)
					})
					r.Route("/npcs", func(r chi.Router) {
						r.Get("/", entities.ListNPCs)
						r.Post("/", entities.CreateNPC)
						r.Route("/{npcId}", func(r chi.Router) {
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
		synopsis := &SynopsisHandler{db: database, encKey: cfg.JWT.Secret}
		brainstorm := &BrainstormHandler{db: database, encKey: cfg.JWT.Secret}
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
					r.Put("/{sceneId}", synopsis.UpdateScene)
					r.Delete("/{sceneId}", synopsis.DeleteScene)
					r.Post("/{sceneId}/npcs", synopsis.AddSceneNPC)
					r.Delete("/{sceneId}/npcs/{npcId}", synopsis.RemoveSceneNPC)
					r.Post("/{sceneId}/artefacts", synopsis.AddSceneArtefact)
					r.Delete("/{sceneId}/artefacts/{artefactId}", synopsis.RemoveSceneArtefact)
					r.Post("/{sceneId}/llm/develop", synopsis.DevelopScene)
				})
				r.Route("/llm", func(r chi.Router) {
					r.Post("/complete-hook", synopsis.CompleteHook)
					r.Post("/suggest-npcs", synopsis.SuggestNPCs)
					r.Post("/develop-npc/{npcId}", synopsis.DevelopNPC)
					r.Post("/suggest-scene", synopsis.SuggestScene)
					r.Post("/generate-overview", synopsis.GenerateOverview)
				})
			})

			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", synopsis.ListSessions)
				r.Post("/", synopsis.CreateSession)
				r.Route("/{sessionId}", func(r chi.Router) {
					r.Put("/", synopsis.UpdateSession)
					r.Delete("/", synopsis.DeleteSession)
					r.Get("/scenes", synopsis.GetSessionScenes)
					r.Put("/scenes/{sceneId}", synopsis.SetSessionSceneState)
					r.Delete("/scenes/{sceneId}", synopsis.ClearSessionSceneState)
					r.Get("/players", synopsis.ListSessionPlayers)
					r.Put("/players/{userId}", synopsis.SetSessionPlayer)
					r.Delete("/players/{userId}", synopsis.RemoveSessionPlayer)

					// Table surface, GM side
					r.Post("/table-token", tableHandler.EnsureToken)
					r.Put("/projection", tableHandler.SetProjection)
					r.Delete("/projection", tableHandler.ClearProjection)
					r.Get("/rolls", tableHandler.ListRolls)
					r.Post("/rolls", tableHandler.GMRoll)
				})
			})

			r.Route("/brainstorm/threads", func(r chi.Router) {
				r.Get("/", brainstorm.ListThreads)
				r.Post("/", brainstorm.CreateThread)
				r.Route("/{threadId}", func(r chi.Router) {
					r.Put("/", brainstorm.RenameThread)
					r.Delete("/", brainstorm.DeleteThread)
					r.Get("/messages", brainstorm.GetMessages)
					r.Post("/messages", brainstorm.SendMessage)
				})
			})
		})
	})

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

func rateLimitMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Rate limiting stub - implement properly later
			next.ServeHTTP(w, r)
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
