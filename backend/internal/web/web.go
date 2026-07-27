// Package web serves the built frontend from inside the binary, so that
// deploying Lore is copying one file. `make build` drops the Vite output into
// dist/ just before `go build`, and go:embed bakes it in.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Only .gitkeep is tracked; a development build embeds just that and Available
// reports false, so the API still runs with the Vite dev server in front.
//
//go:embed all:dist
var embedded embed.FS

// Assets returns the built frontend, and whether one was embedded at all.
func Assets() (fs.FS, bool) {
	sub, err := fs.Sub(embedded, "dist")
	if err != nil {
		return nil, false
	}
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return nil, false
	}
	return sub, true
}

// Handler serves the single-page app: a real file when the path matches one,
// index.html otherwise, because /campaigns/<uuid> is a client-side route that
// the server knows nothing about.
//
// It must never answer for /api, /uploads or /external-material — those are
// registered as their own routes and reaching this handler would turn a
// genuine 404 into a page of HTML.
func Handler(assets fs.FS) http.Handler {
	files := http.FileServer(http.FS(assets))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + strings.TrimPrefix(r.URL.Path, "/"))

		if f, err := assets.Open(strings.TrimPrefix(clean, "/")); err == nil {
			info, statErr := f.Stat()
			f.Close()
			if statErr == nil && !info.IsDir() {
				// Vite emits content-hashed asset names, so they can be cached
				// hard; index.html must not be, or a deploy never lands.
				if strings.HasPrefix(clean, "/assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				files.ServeHTTP(w, r)
				return
			}
		}

		w.Header().Set("Cache-Control", "no-cache")
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		files.ServeHTTP(w, r2)
	})
}
