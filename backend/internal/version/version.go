// Package version holds build identity, set via -ldflags at link time (see
// `make build`). A binary built any other way — `go build` directly, or the
// `air` dev server — keeps the zero values below, which read as "dev": that
// is the point, so a screenshot or a bug report immediately tells apart a
// local run from what's deployed.
package version

var (
	Version   = "dev"
	Commit    = ""
	BuildTime = ""
)
