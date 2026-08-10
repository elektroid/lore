package handlers

import (
	"encoding/json"
	"net/http"

	"lore/internal/version"
)

type versionResponse struct {
	Version   string `json:"version"`
	Commit    string `json:"commit"`
	BuildTime string `json:"build_time"`
}

// Version reports the build identity baked in by `make build` (see
// internal/version). Public — the login page shows it too, and a group
// member reporting a bug shouldn't need a session to say what they're on.
func Version(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(versionResponse{
		Version:   version.Version,
		Commit:    version.Commit,
		BuildTime: version.BuildTime,
	})
}
