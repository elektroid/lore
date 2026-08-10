package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"lore/internal/version"
)

// serverStart approximates process start — set at package init, which runs
// within milliseconds of main() on any real deployment.
var serverStart = time.Now()

type ServerInfoHandler struct {
	db                  *sql.DB
	dbPath              string
	uploadsDir          string
	externalMaterialDir string
}

type diskInfo struct {
	FreeBytes  uint64 `json:"free_bytes"`
	TotalBytes uint64 `json:"total_bytes"`
}

type serverInfoResponse struct {
	Version               string   `json:"version"`
	Commit                string   `json:"commit"`
	BuildTime             string   `json:"build_time"`
	GoVersion             string   `json:"go_version"`
	OS                    string   `json:"os"`
	Arch                  string   `json:"arch"`
	UptimeSeconds         int64    `json:"uptime_seconds"`
	Disk                  diskInfo `json:"disk"`
	DatabaseBytes         int64    `json:"database_bytes"`
	UploadsBytes          int64    `json:"uploads_bytes"`
	ExternalMaterialBytes int64    `json:"external_material_bytes"`
	UserCount             int      `json:"user_count"`
}

// dirSize walks a directory tree and sums file sizes. Missing directories
// (e.g. external material never configured) just contribute zero.
func dirSize(path string) int64 {
	var total int64
	filepath.WalkDir(path, func(_ string, d os.DirEntry, err error) error { //nolint:errcheck
		if err != nil || d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
		}
		return nil
	})
	return total
}

// GetServerInfo reports instance-level facts an operator would otherwise
// need shell access to check: free disk space on the volume holding the
// database, on-disk footprint of the data directories, and build/runtime
// identity.
func (h *ServerInfoHandler) GetServerInfo(w http.ResponseWriter, r *http.Request) {
	var disk diskInfo
	var stat syscall.Statfs_t
	diskDir := filepath.Dir(h.dbPath)
	if err := syscall.Statfs(diskDir, &stat); err == nil {
		disk = diskInfo{
			FreeBytes:  uint64(stat.Bavail) * uint64(stat.Bsize),
			TotalBytes: uint64(stat.Blocks) * uint64(stat.Bsize),
		}
	}

	var dbBytes int64
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if info, err := os.Stat(h.dbPath + suffix); err == nil {
			dbBytes += info.Size()
		}
	}

	var userCount int
	h.db.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM users`).Scan(&userCount) //nolint:errcheck

	writeJSON(w, http.StatusOK, serverInfoResponse{
		Version:               version.Version,
		Commit:                version.Commit,
		BuildTime:             version.BuildTime,
		GoVersion:             runtime.Version(),
		OS:                    runtime.GOOS,
		Arch:                  runtime.GOARCH,
		UptimeSeconds:         int64(time.Since(serverStart).Seconds()),
		Disk:                  disk,
		DatabaseBytes:         dbBytes,
		UploadsBytes:          dirSize(h.uploadsDir),
		ExternalMaterialBytes: dirSize(h.externalMaterialDir),
		UserCount:             userCount,
	})
}
