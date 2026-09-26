#!/bin/bash

# =======================================================
# 校园论坛系统 - Linux 配置向导
# =======================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# 交互检测
is_interactive() { [[ -t 0 ]] && [[ -t 1 ]]; }

ask_yes_no() {
    local prompt="$1" default="$2"
    if is_interactive; then
        echo -en "${CYAN}[?] $prompt ${NC}"
        read answer
        case "$answer" in [Yy]) return 0;; [Nn]) return 1;; *) [[ "$default" == "Y" ]] && return 0 || return 1;; esac
    else
        [[ "$default" == "Y" ]] && return 0 || return 1
    fi
}

ask_input() {
    local prompt="$1" default="$2"
    if is_interactive; then
        echo -en "${CYAN}[?] $prompt ${NC}"
        read answer
        echo "${answer:-$default}"
    else
        echo "$default"
    fi
}

# 检测内网IP
detect_internal_ip() {
    local ip=""
    ip=$(hostname -I 2>/dev/null | grep -oE '192\.168\.[0-9]+\.[0-9]+' | head -1)
    if [[ -z "$ip" ]]; then
        ip=$(hostname -I 2>/dev/null | grep -oE '10\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    fi
    echo "$ip"
}

# 备份带时间戳
backup_file() {
    local file="$1"
    if [[ -f "$file" ]]; then
        local timestamp=$(date +%Y%m%d_%H%M%S)
        cp "$file" "${file}.bak.${timestamp}" 2>/dev/null && log_info "已备份 $file -> ${file}.bak.${timestamp}"
    fi
}

# 更新 .env 中的键值（安全处理特殊字符）
update_env_key() {
    local key="$1"
    local value="$2"
    local env_file=".env"
    if [[ -z "$value" ]]; then
        return
    fi
    # 转义 value 中的 / 和 & 等 sed 特殊字符
    local escaped_value=$(printf '%s\n' "$value" | sed 's/[\/&]/\\&/g')
    if grep -q "^${key}=" "$env_file" 2>/dev/null; then
        sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$env_file"
    else
        echo "${key}=${value}" >> "$env_file"
    fi
}

# =======================================================
# 主流程
# =======================================================
echo -e "${CYAN}"
echo "========================================================"
echo "            校园论坛系统 - Linux 配置向导"
echo "========================================================"
echo -e "${NC}"
echo "本脚本仅修改配置，不安装任何依赖或服务"
echo.

# 切换到脚本所在目录
cd "$(dirname "$0")" || { log_error "无法切换到脚本目录"; exit 1; }

# 检测现有配置
echo "[检测] 扫描现有配置文件..."
echo.
[[ -f ".env" ]] && echo -e "  ${GREEN}[发现]${NC} .env 已存在" || echo -e "  ${YELLOW}[新建]${NC} .env 将创建"
[[ -f "data/config.json" ]] && echo -e "  ${GREEN}[发现]${NC} data/config.json 已存在" || echo -e "  ${YELLOW}[新建]${NC} data/config.json 将创建"
mkdir -p data 2>/dev/null
echo.

# 菜单
echo "请选择操作模式："
echo "  1) 交互式配置（推荐）- 逐一输入各项配置"
echo "  2) 快速配置 - 仅添加管理员 QQ 号"
echo "  3) 查看当前配置"
echo "  4) 智能更新 SERVER_IP（检测内网IP并更新）"
echo "  5) 退出"
echo.
MODE_CHOICE=$(ask_input "请选择 (1-5): " "")

case "$MODE_CHOICE" in
    5) echo "已退出"; exit 0 ;;
    3) ;;
    4) ;;
    1|2) ;;
    *) log_error "无效选择"; exit 1 ;;
esac

# ==================== 查看配置 ====================
if [[ "$MODE_CHOICE" == "3" ]]; then
    echo ""
    echo -e "${CYAN}========================================================${NC}"
    echo -e "${CYAN}                   当前配置${NC}"
    echo -e "${CYAN}========================================================${NC}"
    echo ""
    if [[ -f ".env" ]]; then
        echo -e "${BOLD}[.env]${NC}"
        grep -v -E "(PASSWORD|SECRET|KEY|PASS)" .env 2>/dev/null || true
    else
        echo "  .env 不存在"
    fi
    echo ""
    if [[ -f "data/config.json" ]]; then
        echo -e "${BOLD}[data/config.json]${NC}"
        cat data/config.json
    else
        echo "  data/config.json 不存在"
    fi
    echo ""
    exit 0
fi

# ==================== 智能更新 IP ====================
if [[ "$MODE_CHOICE" == "4" ]]; then
    echo ""
    log_info "正在检测内网IP..."
    DETECTED_IP=$(detect_internal_ip)
    if [[ -n "$DETECTED_IP" ]]; then
        log_info "检测到 IP: ${BOLD}$DETECTED_IP${NC}"
        if [[ -f ".env" ]]; then
            backup_file ".env"
            update_env_key "SERVER_IP" "$DETECTED_IP"
            log_success "已更新 .env 中的 SERVER_IP"
        else
            echo "SERVER_IP=$DETECTED_IP" > .env
            log_success "已创建 .env 并设置 SERVER_IP"
        fi
    else
        log_warn "未检测到内网IP（192.168.x.x 或 10.x.x.x），请手动配置"
        echo "提示：可编辑 .env 文件添加 SERVER_IP=你的内网IP"
    fi
    exit 0
fi

# ==================== 收集配置 ====================
ADMIN_USERS_ARRAY=()
SERVER_IP=""
CORS_ORIGIN="http://localhost:2080"
SMTP_HOST=""
SMTP_PORT=""
SMTP_USER=""
SMTP_PASS=""

if [[ "$MODE_CHOICE" == "1" ]] || [[ "$MODE_CHOICE" == "2" ]]; then
    echo ""
    echo -e "${CYAN}========================================================${NC}"
    if [[ "$MODE_CHOICE" == "1" ]]; then
        echo -e "${CYAN}               交互式配置${NC}"
    else
        echo -e "${CYAN}               快速配置 - 管理员${NC}"
    fi
    echo -e "${CYAN}========================================================${NC}"
    echo ""
fi

# 管理员 QQ 号收集
if [[ "$MODE_CHOICE" == "1" ]] || [[ "$MODE_CHOICE" == "2" ]]; then
    echo -e "${BOLD}[管理员 QQ 号]${NC} 输入空行结束（QQ号为5-15位数字）"
    while true; do
        read -p " QQ号 (直接回车结束): " qq
        if [[ -z "$qq" ]]; then
            break
        elif [[ "$qq" =~ ^[0-9]{5,15}$ ]]; then
            ADMIN_USERS_ARRAY+=("$qq")
        else
            log_warn "QQ号必须是5-15位数字，请重新输入"
        fi
    done
fi

# 交互模式的额外配置
if [[ "$MODE_CHOICE" == "1" ]]; then
    echo ""
    echo -e "${BOLD}[服务器 IP]${NC}"
    read -p " 内网IP (例如 192.168.2.4，留空自动检测): " SERVER_IP
    if [[ -z "$SERVER_IP" ]]; then
        SERVER_IP=$(detect_internal_ip)
        if [[ -n "$SERVER_IP" ]]; then
            log_info "自动检测: $SERVER_IP"
        fi
    fi

    echo ""
    echo -e "${BOLD}[CORS 白名单]${NC}"
    read -p " CORS白名单 (多个用逗号分隔，默认 http://localhost:3000): " input_cors
    [[ -n "$input_cors" ]] && CORS_ORIGIN="$input_cors"

    echo ""
    echo -e "${BOLD}[邮件服务]${NC}（可跳过，直接回车）"
    read -p " SMTP服务器 (例如 smtp.qq.com): " SMTP_HOST
    if [[ -n "$SMTP_HOST" ]]; then
        read -p " SMTP端口 (默认465): " SMTP_PORT
        SMTP_PORT=${SMTP_PORT:-465}
        # 端口校验
        if [[ ! "$SMTP_PORT" =~ ^[0-9]+$ ]]; then
            log_warn "端口必须为数字，已重置为465"
            SMTP_PORT=465
        fi
        read -p " 邮箱账号: " SMTP_USER
        read -sp " 邮箱授权码: " SMTP_PASS
        echo
    fi
fi

# ==================== 写入配置 ====================
echo ""
log_info "正在更新配置文件..."

# 备份 .env
if [[ -f ".env" ]]; then
    backup_file ".env"
fi

# 更新 .env
if [[ -f ".env" ]]; then
    # 先确保 .env 存在
    if [[ -n "$SERVER_IP" ]]; then
        update_env_key "SERVER_IP" "$SERVER_IP"
    fi
    if [[ -n "$CORS_ORIGIN" ]]; then
        update_env_key "CORS_ORIGIN" "$CORS_ORIGIN"
    fi
    if [[ -n "$SMTP_HOST" ]]; then
        update_env_key "SMTP_HOST" "$SMTP_HOST"
        update_env_key "SMTP_PORT" "$SMTP_PORT"
        update_env_key "SMTP_USER" "$SMTP_USER"
        update_env_key "SMTP_PASS" "$SMTP_PASS"
    fi
    log_success ".env 已更新"
else
    # 新建 .env
    # JWT 密钥随机生成：此前写死 'please_run_deploy_script_first'，若使用者
    # 直接跑 setup.sh 而没有跑 deploy.sh，全站就用这个公开的占位密钥签发令牌（可伪造）
    gen_secret() {
        if command -v openssl &> /dev/null; then
            openssl rand -base64 48 | tr -d '\n'
        else
            # 无 openssl 时用 /dev/urandom 兜底
            head -c 48 /dev/urandom | base64 | tr -d '\n'
        fi
    }
    JWT_SECRET_VALUE="$(gen_secret)"
    ADMIN_JWT_SECRET_VALUE="$(gen_secret)"

    # 先用 umask 077 建文件：.env 含 JWT 密钥与数据库口令，不能以默认 644 落盘
    # （404/644 期间任何本机用户都能读到密钥；等脚本末尾再 chmod 600 已经晚了）
    (umask 077; cat > .env <<EOF
# 校园论坛环境配置
PORT=2080
NODE_ENV=production

MONGODB_URI=mongodb://localhost:27017/school-forum
REDIS_HOST=localhost
REDIS_PORT=6379

JWT_SECRET=$JWT_SECRET_VALUE
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
ADMIN_JWT_SECRET=$ADMIN_JWT_SECRET_VALUE
ADMIN_JWT_EXPIRES_IN=24h

CORS_ORIGIN=$CORS_ORIGIN
EOF
    )
    [[ -n "$SERVER_IP" ]] && echo "SERVER_IP=$SERVER_IP" >> .env
    [[ -n "$SMTP_HOST" ]] && cat >> .env <<EOF
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
EOF
    chmod 600 .env 2>/dev/null || true
    log_success ".env 已创建（权限 600）"
fi

# 更新 data/config.json
if [[ ${#ADMIN_USERS_ARRAY[@]} -gt 0 ]]; then
    # 使用 jq 更新 JSON
    if command -v jq &> /dev/null; then
        # 构建 JSON 数组
        local admin_json=$(printf '%s\n' "${ADMIN_USERS_ARRAY[@]}" | jq -R . | jq -s .)
        if [[ -f "data/config.json" ]]; then
            # 备份配置目录的配置
            backup_file "data/config.json"
            tmp=$(mktemp)
            if jq --argjson admins "$admin_json" '.adminUsers = $admins' "data/config.json" > "$tmp" 2>/dev/null; then
                mv "$tmp" "data/config.json"
                log_success "data/config.json 已更新 adminUsers"
            else
                log_error "jq 更新失败，JSON 格式可能无效，请手动检查 data/config.json"
                rm -f "$tmp"
            fi
        else
            # 新建文件
            cat > data/config.json <<EOF
{
  "adminUsers": $admin_json,
  "upload": {
    "allowedTypes": ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
    "maxFileSize": 33554432,
    "maxFiles": 32
  },
  "password": { "saltRounds": 10 },
  "pagination": { "defaultPage": 1, "defaultLimit": 100 },
  "contentLimits": {
    "post": 10000,
    "comment": 500,
    "username": { "min": 2, "max": 20 },
    "qq": { "min": 5, "max": 15 },
    "password": { "min": 6 }
  },
  "schools": []
}
EOF
            log_success "data/config.json 已创建"
        fi
    else
        log_warn "jq 未安装，无法自动更新 JSON。请手动编辑 data/config.json 中的 adminUsers 字段"
    fi
else
    log_info "管理员未修改，跳过 data/config.json"
fi

# 配置文件权限收口：.env 与 data/config.json 都含 JWT 密钥/数据库口令，统一收敛到 600
if [[ -f ".env" ]]; then
    chmod 600 ".env" 2>/dev/null || true
fi
if [[ -f "data/config.json" ]]; then
    chmod 600 "data/config.json" 2>/dev/null || true
fi

# 最终提示
echo ""
echo -e "${GREEN}========================================================${NC}"
echo -e "${GREEN}                   配置完成！${NC}"
echo -e "${GREEN}========================================================${NC}"
echo ""
echo "配置文件位置："
[[ -f ".env" ]] && echo "  .env - 已更新"
[[ -f "data/config.json" ]] && echo "  data/config.json - 已更新"
echo ""
echo "备份文件（可删除旧备份）："
ls -t .env.bak.* 2>/dev/null | head -3 | sed 's/^/  /'
echo ""
echo "如需完整配置（JWT密钥等），请运行 ./deploy.sh 进行初始化部署"
echo ""
echo "数据库说明："
echo "  本项目 MongoDB 由 docker-compose.yml（mongo:4.4 容器）提供。"
echo "  启动前请确认 Docker 已运行，然后执行：  docker compose up -d"
echo "  连接串 MONGODB_URI 已指向 mongodb://localhost:27017/school-forum，无需修改。"