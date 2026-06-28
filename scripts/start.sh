#!/bin/bash

# FreeDeepseekAPI Production Startup Script
# This script starts the API server with production settings

set -e

# Configuration
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$APP_DIR/logs"
PID_FILE="$APP_DIR/.pid"
LOG_FILE="$LOG_DIR/production.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Function to log messages
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Function to check if the server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        else
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Function to start the server
start_server() {
    if is_running; then
        warn "Server is already running (PID: $(cat "$PID_FILE"))"
        return 1
    fi

    log "Starting FreeDeepseekAPI server..."
    
    # Check if config directory exists
    if [ ! -d "$APP_DIR/config" ]; then
        mkdir -p "$APP_DIR/config"
        warn "Config directory created. Please place deepseek-auth.json in config/"
    fi
    
    # Check if auth file exists
    if [ ! -f "$APP_DIR/config/deepseek-auth.json" ]; then
        warn "deepseek-auth.json not found in config/ directory"
        warn "Please copy your auth file to: $APP_DIR/config/deepseek-auth.json"
    fi

    # Start the server in background
    cd "$APP_DIR"
    NODE_ENV=production \
    PORT=9655 \
    HOST=0.0.0.0 \
    DEEPSEEK_AUTH_PATH=/app/config/deepseek-auth.json \
    LOG_LEVEL=info \
    nohup node src/server/index.js >> "$LOG_FILE" 2>&1 &
    
    local pid=$!
    echo $pid > "$PID_FILE"
    
    # Wait for server to start
    sleep 2
    if is_running; then
        log "Server started successfully (PID: $pid)"
        log "Log file: $LOG_FILE"
        log "Access API at: http://localhost:9655"
    else
        error "Failed to start server. Check logs at $LOG_FILE"
        return 1
    fi
}

# Function to stop the server
stop_server() {
    if ! is_running; then
        warn "Server is not running"
        return 1
    fi
    
    local pid=$(cat "$PID_FILE")
    log "Stopping server (PID: $pid)..."
    
    kill "$pid" 2>/dev/null || true
    
    # Wait for process to terminate
    local count=0
    while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
        sleep 1
        count=$((count + 1))
    done
    
    if kill -0 "$pid" 2>/dev/null; then
        warn "Force killing process..."
        kill -9 "$pid" 2>/dev/null || true
    fi
    
    rm -f "$PID_FILE"
    log "Server stopped"
}

# Function to restart the server
restart_server() {
    log "Restarting server..."
    stop_server
    sleep 1
    start_server
}

# Function to show server status
status_server() {
    if is_running; then
        local pid=$(cat "$PID_FILE")
        log "Server is running (PID: $pid)"
        
        # Check health endpoint
        if command -v curl &> /dev/null; then
            log "Health check: $(curl -s http://localhost:9655/health || echo 'failed')"
        fi
    else
        warn "Server is not running"
    fi
}

# Function to show logs
tail_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        warn "Log file not found: $LOG_FILE"
    fi
}

# Main command handling
case "${1:-start}" in
    start)
        start_server
        ;;
    stop)
        stop_server
        ;;
    restart)
        restart_server
        ;;
    status)
        status_server
        ;;
    logs)
        tail_logs
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo "  start   - Start the server"
        echo "  stop    - Stop the server"
        echo "  restart - Restart the server"
        echo "  status  - Show server status"
        echo "  logs    - Tail server logs"
        exit 1
        ;;
esac

exit 0
