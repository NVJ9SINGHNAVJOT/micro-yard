package middleware

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/navjot/storage-service/pkg"
)

type contextKey string

const loggerKey contextKey = "logger"

// statusRecorder wraps http.ResponseWriter to capture the status code and the
// number of bytes written, so the logging middleware can report them once the
// handler has finished.
type statusRecorder struct {
	http.ResponseWriter
	status      int
	bytes       int
	wroteHeader bool
}

func (r *statusRecorder) WriteHeader(status int) {
	if r.wroteHeader {
		return
	}
	r.status = status
	r.wroteHeader = true
	r.ResponseWriter.WriteHeader(status)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		// Handlers that write without calling WriteHeader implicitly send 200.
		r.WriteHeader(http.StatusOK)
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// Logging assigns a unique request ID to every incoming request, logs when the
// request is received and when the response is sent, and exposes a
// request-scoped logger (carrying the request ID) via the request context so
// handler logs can be correlated for tracing.
func Logging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID, err := pkg.NewUUID()
		if err != nil {
			requestID = "unknown"
		}

		logger := slog.Default().With("request_id", requestID)
		w.Header().Set("X-Request-ID", requestID)

		logger.Info("request received",
			"method", r.Method,
			"path", r.URL.Path,
			"query", r.URL.RawQuery,
			"remote_addr", r.RemoteAddr,
		)

		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()

		ctx := context.WithValue(r.Context(), loggerKey, logger)
		next.ServeHTTP(rec, r.WithContext(ctx))

		logger.Info("request completed",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"bytes", rec.bytes,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// LoggerFromContext returns the request-scoped logger stored by the Logging
// middleware. It falls back to the default logger when none is present so
// callers never have to nil-check.
func LoggerFromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(loggerKey).(*slog.Logger); ok {
		return logger
	}
	return slog.Default()
}
