#!/bin/bash

# =======================================================
# 校园论坛系统 - Linux 服务启动脚本
# =======================================================

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 日志函数
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 通过 Docker 拉起依赖服务（仅当端口空闲且存在对应容器/compose 时）
# 用法: start_dep_via_docker <容器名> <端口>
start_dep_via_docker() {
    local svc="$1" port="$2"
    # 端口已被占用（可能是本机原生服务），不抢占端口
    if command -v nc &> /dev/null && nc -z "localhost" "$port" 2>/dev/null; then
        return 0
    fi
    if ! command -v docker &> /dev/null; then
        return 1
    fi
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$svc"; then
        return 0
    fi
    if [[ -f "docker-compose.yml" ]]; then
        log_info "通过 docker compose 启动 $svc ..."
        docker compose up -d 2>/dev/null && return 0
    fi
    # 容器不存在时不要盲目 docker start（此前对不存在的 forum-redis 也会尝试一次，
    # 报错噪音且掩盖了「compose 里根本没有 redis 服务」这个事实）
    if ! docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$svc"; then
        return 1
    fi
    docker start "$svc" 2>/dev/null && return 0
    return 1
}

# 检测是否为交互式终端
is_interactive() {
    [ -t 0 ] && [ -t 1 ]
}

# 获取脚本所在目录并进入
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || { log_error "无法进入脚本目录"; exit 1; }

# 显示标题
echo "========================================================"
echo "               校园论坛服务启动脚本"
echo "========================================================"
echo ""

# ==================== 1. 检查必要文件 ====================
if [ ! -f "server.js" ]; then
    log_error "未找到 server.js，请确保在项目根目录运行此脚本"
    exit 1
fi

# ==================== 2. 检查 Node.js ====================
log_info "检查 Node.js..."
if ! command -v node &> /dev/null; then
    log_error "未找到 Node.js，请先安装 Node.js 18+"
    echo "  下载地址: https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node -v)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'v' -f2 | cut -d'.' -f1)
log_success "Node.js 版本: $NODE_VERSION"

if [ "$NODE_MAJOR" -lt 18 ]; then
    log_error "Node.js 版本过低 (v$NODE_MAJOR)，请升级至 18 或更高版本"
    exit 1
fi

# ==================== 3. 安装依赖（若需要） ====================
if [ ! -d "node_modules" ]; then
    log_info "正在安装项目依赖..."
    if npm install; then
        log_success "依赖安装完成"
    else
        log_error "依赖安装失败，请检查网络或 package.json"
        exit 1
    fi
else
    log_success "依赖已安装"
fi

# ==================== 4. 检查环境变量文件 ====================
if [ ! -f ".env" ]; then
    log_warn "未找到 .env 配置文件，请确保已正确配置（可运行 deploy.sh 生成）"
fi

# ==================== 5. 检查 MongoDB ====================
log_info "检查 MongoDB 状态..."
MONGODB_OK=false

# 若未运行，优先尝试用 Docker 拉起（本项目 MongoDB 由 docker-compose 提供）
start_dep_via_docker mongodb44 27017 || true

# 方法1：检查进程
if pgrep -x "mongod" >/dev/null; then
    log_success "MongoDB 进程正在运行"
    MONGODB_OK=true
# 方法2：检查端口
elif command -v nc &> /dev/null && nc -z localhost 27017 2>/dev/null; then
    log_success "MongoDB 端口 27017 已监听"
    MONGODB_OK=true
# 方法3：尝试使用 mongosh 或 mongo 连接
elif command -v mongosh &> /dev/null && mongosh --eval "db.runCommand({ping:1})" --quiet >/dev/null 2>&1; then
    log_success "MongoDB 可正常连接"
    MONGODB_OK=true
else
    log_warn "MongoDB 未运行或无法连接"
    echo "  请确保 MongoDB 服务已启动，或使用 Atlas 云数据库"
fi

if [ "$MONGODB_OK" = false ]; then
    echo "  提示：如果使用外部 MongoDB，请忽略此警告"
fi

# ==================== 6. 检查 Redis（可选，交互式启动）====================
log_info "检查 Redis 状态..."
REDIS_OK=false

# 若未运行，尝试用 Docker 拉起 Redis（容器名按常见命名依次探测；
# docker-compose.yml 中并没有 redis 服务，这里的探测失败会安静跳过）
start_dep_via_docker forum-redis 6379 || start_dep_via_docker redis 6379 || start_dep_via_docker redis-server 6379 || true

# 检测 Redis 客户端是否存在
if command -v redis-cli &> /dev/null; then
    # 尝试 ping
    if redis-cli ping >/dev/null 2>&1; then
        log_success "Redis 正在运行并可连接"
        REDIS_OK=true
    else
        log_warn "Redis 未运行"
        # 仅在交互式终端询问是否启动
        if is_interactive; then
            read -p "是否尝试自动启动 Redis？[y/N]: " START_REDIS
            if [[ "$START_REDIS" =~ ^[Yy]$ ]]; then
                # 尝试通过 systemd 启动
                if systemctl is-active --quiet redis 2>/dev/null || systemctl is-active --quiet redis-server 2>/dev/null; then
                    log_success "Redis 已通过 systemd 运行"
                    REDIS_OK=true
                elif command -v systemctl &> /dev/null && systemctl start redis 2>/dev/null; then
                    log_success "Redis 已通过 systemd 启动"
                    sleep 2
                    if redis-cli ping >/dev/null 2>&1; then
                        REDIS_OK=true
                    fi
                elif command -v redis-server &> /dev/null; then
                    # 直接启动守护进程（可能因权限失败）
                    log_info "尝试直接启动 redis-server..."
                    redis-server --daemonize yes 2>/dev/null
                    sleep 2
                    if redis-cli ping >/dev/null 2>&1; then
                        log_success "Redis 已启动"
                        REDIS_OK=true
                    else
                        log_warn "自动启动失败，请手动启动 Redis"
                    fi
                else
                    log_warn "无法自动启动 Redis，请手动启动后重试"
                fi
            fi
        else
            log_warn "非交互模式，跳过 Redis 启动"
        fi
    fi
else
    # 没有 redis-cli：若 6379 端口已通（可能由 Docker 提供），视为可用
    if command -v nc &> /dev/null && nc -z localhost 6379 2>/dev/null; then
        log_success "Redis 端口 6379 已监听（可能由 Docker 提供）"
        REDIS_OK=true
    else
        log_warn "未找到 redis-cli，Redis 可能未安装，缓存功能将不可用"
    fi
fi

if [ "$REDIS_OK" = false ]; then
    log_warn "Redis 不可用，论坛将无法使用缓存功能（不影响核心功能）"
fi

# ==================== 7. 启动服务 ====================
echo ""
log_info "正在启动论坛服务..."
echo "========================================================"
echo ""

# 使用 exec 替换当前进程，方便信号传递
# 注意不要写成 `if ! node server.js; then EXIT_CODE=$?`：
# `!` 取反后 $? 恒为 0，错误码永远显示 0（掩盖真实失败原因）
node server.js
EXIT_CODE=$?
if [ "$EXIT_CODE" -ne 0 ]; then
    echo ""
    log_error "服务启动失败，错误码: $EXIT_CODE"
    echo "常见问题排查："
    echo "  1. 检查 .env 配置是否正确（尤其是数据库连接）"
    echo "  2. 确认 MongoDB 服务已启动并可访问"
    PORT_HINT="$(grep -E '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2 | tr -d '[:space:]')"
    echo "  3. 确认端口未被占用（当前配置端口: ${PORT_HINT:-2080}）"
    echo "  4. 查看上方错误日志获取详细信息"
    exit "$EXIT_CODE"
fi

# 正常情况下不会执行到这里（node 会持续运行直到被终止）
log_success "服务已正常退出"