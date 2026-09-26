#!/bin/bash

# =======================================================
# 校园论坛系统 
# 支持 Ubuntu 20.04/22.04, Debian 11+, CentOS 7/8/9, Rocky Linux
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
log_step() { echo -e "\n${CYAN}--- $1 ---${NC}\n"; }

print_banner() {
    echo -e "${CYAN}"
    echo "========================================================"
    echo "            校园论坛系统 - 一键部署脚本"
    echo "              自动化安装环境 · 交互式配置"
    echo "========================================================"
    echo -e "${NC}"
}

print_section() {
    echo -e "\n${MAGENTA}========================================================${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}========================================================${NC}"
}

# 判断是否可交互：stdin 是终端，或存在可用控制终端 /dev/tty
# 这样即使通过 `curl ... | bash` 管道执行，只要运行环境有真实终端，也能向用户提问
is_interactive() { [[ -t 0 ]] || [[ -c /dev/tty ]]; }

# 从真实终端(/dev/tty)或 stdin 读取一行输入，兼容管道(curl|bash)场景
# 用法: prompt_read <变量名> "<提示>" [默认值] [silent]
prompt_read() {
    local __var="$1" __text="$2" __default="${3:-}" __silent="${4:-}" __val=""
    if [[ -c /dev/tty ]] && { [[ -t 1 ]] || [[ -t 2 ]]; }; then
        if [[ "$__silent" == "silent" ]]; then
            read -r -s -p "$__text" __val < /dev/tty
            echo >&2
        else
            read -r -p "$__text" __val < /dev/tty
        fi
    else
        if [[ "$__silent" == "silent" ]]; then
            read -r -s -p "$__text" __val
            echo
        else
            read -r -p "$__text" __val
        fi
    fi
    __val="${__val:-$__default}"
    printf -v "$__var" '%s' "$__val"
}

ask_yes_no() {
    local prompt="$1" default="$2"
    if is_interactive; then
        while true; do
            prompt_read answer "${CYAN}[?] $prompt ${NC}" "$default"
            case "$answer" in
                [Yy]) return 0 ;;
                [Nn]) return 1 ;;
                "") [[ "$default" == "Y" ]] && return 0 || return 1 ;;
                *) echo -e "${YELLOW}请输入 Y 或 N${NC}" ;;
            esac
        done
    else
        [[ "$default" == "Y" ]] && return 0 || return 1
    fi
}

ask_option() {
    local prompt="$1" default="$2"
    if is_interactive; then
        prompt_read answer "${CYAN}[?] $prompt ${NC}" "$default"
        echo "${answer:-$default}"
    else
        echo "$default"
    fi
}

# 校验正整数
validate_positive_int() {
    local value="$1"
    [[ "$value" =~ ^[1-9][0-9]*$ ]]
}

# 校验4位年份
validate_year() {
    local value="$1"
    [[ "$value" =~ ^[0-9]{4}$ ]] && [ "$value" -ge 2000 ] && [ "$value" -le 2100 ]
}

# 校验QQ号（5-15位数字）
validate_qq() {
    local value="$1"
    [[ "$value" =~ ^[0-9]{5,15}$ ]]
}

# Root 或 sudo 检查
check_root() {
    if [[ $EUID -ne 0 ]]; then
        if ! command -v sudo &> /dev/null; then
            log_error "需要 root 权限或 sudo 命令"
            exit 1
        fi
        SUDO="sudo"
    else
        SUDO=""
    fi
}

# 检测操作系统
detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS=$ID
        VERSION=$VERSION_ID
        VERSION_MAJOR=$(echo "$VERSION" | cut -d. -f1)
    else
        log_error "无法检测操作系统"
        exit 1
    fi
    log_info "检测到操作系统: ${BOLD}$OS $VERSION${NC}"
    case $OS in
        ubuntu|debian)            PKG_MANAGER="apt" ;;
        centos|rhel|rocky|alma)   PKG_MANAGER="yum" ;;
        fedora)                   PKG_MANAGER="dnf" ;;
        *) log_warn "未完全支持: $OS，将尝试 apt 模式"; PKG_MANAGER="apt" ;;
    esac
}

# CPU AVX2 检测
check_avx2() {
    log_info "检查 CPU 指令集（AVX2）..."
    if grep -q avx2 /proc/cpuinfo; then
        log_success "CPU 支持 AVX2，可安装 MongoDB 5.0+"
        return 0
    else
        log_warn "CPU 不支持 AVX2，将安装 MongoDB 4.4（兼容版本）"
        return 1
    fi
}

# 镜像连通性测试
test_mirror() {
    local mirror_host="$1"
    log_info "测试镜像源连通性: $mirror_host ..."
    if curl -s --connect-timeout 5 "http://$mirror_host" >/dev/null 2>&1; then
        log_success "镜像源可达"
        return 0
    else
        log_warn "镜像源不可达，将使用官方源"
        return 1
    fi
}

# 智能切换镜像
smart_switch_mirror() {
    log_info "配置软件源为清华镜像（加速下载）..."
    local mirror_domain="mirrors.tuna.tsinghua.edu.cn"
    $SUDO cp /etc/apt/sources.list /etc/apt/sources.list.bak.$(date +%s) 2>/dev/null || true
    case $OS in
        ubuntu|debian)
            if test_mirror "$mirror_domain"; then
                case $OS in
                    ubuntu)
                        $SUDO sed -i 's|archive.ubuntu.com|'"$mirror_domain"'|g' /etc/apt/sources.list
                        $SUDO sed -i 's|security.ubuntu.com|'"$mirror_domain"'|g' /etc/apt/sources.list
                        ;;
                    debian)
                        $SUDO sed -i 's|deb.debian.org|'"$mirror_domain"'|g' /etc/apt/sources.list
                        $SUDO sed -i 's|security.debian.org|'"$mirror_domain"'|g' /etc/apt/sources.list
                        ;;
                esac
                if $SUDO apt update -qq; then
                    log_success "镜像源配置成功"
                    return 0
                else
                    log_warn "apt update 失败，恢复官方源"
                    $SUDO mv /etc/apt/sources.list.bak.* /etc/apt/sources.list 2>/dev/null || true
                    $SUDO apt update -qq
                    return 1
                fi
            fi
            ;;
        centos|rhel|rocky|alma)
            $SUDO sed -i 's|^mirrorlist=|#mirrorlist=|g' /etc/yum.repos.d/CentOS-*.repo
            $SUDO sed -i 's|^#baseurl=http://mirror.centos.org|baseurl=https://mirrors.aliyun.com|g' /etc/yum.repos.d/CentOS-*.repo
            $SUDO yum makecache
            ;;
    esac
}

# 更新系统与软件包（一键脚本可选步骤）
update_system() {
    log_step "更新系统与软件包"
    case $PKG_MANAGER in
        apt)
            log_info "刷新软件源并升级已安装的软件包..."
            $SUDO apt update -qq || log_warn "apt update 失败，继续尝试升级"
            # 无交互升级：自动保留已有配置文件，避免升级时卡在 dpkg 交互
            if $SUDO DEBIAN_FRONTEND=noninteractive apt upgrade -y \
                    -o Dpkg::Options::="--force-confdef" \
                    -o Dpkg::Options::="--force-confold"; then
                log_success "系统软件包已更新到最新"
            else
                log_warn "部分软件包升级失败，可稍后手动执行: sudo apt upgrade"
            fi
            # 清理已不需要的依赖
            $SUDO apt autoremove -y >/dev/null 2>&1 || true
            ;;
        yum)
            log_info "升级已安装软件包 (yum update -y)..."
            $SUDO yum update -y || log_warn "yum update 失败，可稍后手动执行"
            ;;
        dnf)
            log_info "升级已安装软件包 (dnf upgrade -y)..."
            $SUDO dnf upgrade -y || log_warn "dnf upgrade 失败，可稍后手动执行"
            ;;
        *)
            log_warn "未知包管理器 $PKG_MANAGER，跳过系统更新"
            ;;
    esac
}

# 安装基础工具
install_tools() {
    log_step "安装基础工具"
    case $PKG_MANAGER in
        apt)
            if ! $SUDO apt update -qq; then
                log_error "apt update 失败，请检查网络或手动修复软件源"
                exit 1
            fi
            # netcat-openbsd 提供 nc，用于等待 MongoDB 端口就绪；ca-certificates 供 https 下载
            $SUDO apt install -y curl git unzip lsb-release gnupg jq netcat-openbsd ca-certificates
            ;;
        yum|dnf)
            $SUDO $PKG_MANAGER install -y curl git unzip jq nmap-ncat ca-certificates
            if ! command -v lsb_release &> /dev/null; then
                $SUDO $PKG_MANAGER install -y redhat-lsb-core || true
            fi
            ;;
    esac
    log_success "基础工具安装完成"
}

# 安装 Node.js
install_nodejs() {
    log_step "检查并安装 Node.js"
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v)
        log_info "Node.js 已安装: ${BOLD}$NODE_VERSION${NC}"
        NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ $NODE_MAJOR -lt 18 ]]; then
            log_warn "Node.js 版本过低，正在升级到 20 LTS..."
            install_nodejs_from_source || add_missing "Node.js 升级失败，请手动升级到 20 LTS"
        fi
    else
        log_info "未安装 Node.js，正在安装..."
        install_nodejs_from_source || add_missing "Node.js 未安装：请手动安装 Node 20 LTS 后重新运行部署"
    fi
}

install_nodejs_from_source() {
    log_info "安装 Node.js 20 LTS（从清华镜像下载二进制包，免 nvm，更稳定）..."
    local ver="20.18.1"
    # 尝试从清华镜像索引动态获取最新的 v20 版本号（不易过期）；失败则回退到默认值
    local idx
    idx="$(curl -fsSL --connect-timeout 15 "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/" 2>/dev/null)"
    if [[ -n "$idx" ]]; then
        local found
        found="$(echo "$idx" | grep -oE 'v20\.[0-9]+\.[0-9]+' | sort -V | tail -1)"
        [[ -n "$found" ]] && ver="${found#v}"
    fi
    log_info "目标版本: Node.js v${ver}"

    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64) arch="x64" ;;
        aarch64) arch="arm64" ;;
        armv7l) arch="armv7l" ;;
        *) log_warn "未知架构 $arch，将按 x64 尝试"; arch="x64" ;;
    esac

    local base="https://mirrors.tuna.tsinghua.edu.cn/nodejs-release"
    local pkg="node-v${ver}-linux-${arch}.tar.gz"
    local tmp
    tmp="$(mktemp -d)"
    local dest="$tmp/$pkg"

    log_info "下载 Node.js 二进制包: $base/v${ver}/$pkg"
    if ! curl -fL --progress-bar --connect-timeout 20 --max-time 600 -o "$dest" "$base/v${ver}/$pkg"; then
        log_error "Node.js 二进制包下载失败（网络受限或被拦截）"
        rm -rf "$tmp"
        add_missing "Node.js 未安装：请手动安装 Node 20 LTS 后重新运行部署"
        return 1
    fi

    log_info "解压并安装到 /usr/local ..."
    if ! tar -xzf "$dest" -C "$tmp"; then
        log_error "解压 Node.js 包失败，可能下载不完整"
        rm -rf "$tmp"
        add_missing "Node.js 未安装：解压失败"
        return 1
    fi
    local node_dir
    node_dir="$(find "$tmp" -maxdepth 1 -type d -name 'node-v*' | head -1)"
    if [[ -z "$node_dir" ]]; then
        log_error "未找到解压后的 Node 目录"
        rm -rf "$tmp"
        add_missing "Node.js 未安装"
        return 1
    fi
    if ! $SUDO cp -r "$node_dir"/. /usr/local/ 2>/dev/null; then
        log_error "复制到 /usr/local 失败（权限不足？）"
        rm -rf "$tmp"
        add_missing "Node.js 未安装：写入 /usr/local 失败"
        return 1
    fi
    rm -rf "$tmp"
    hash -r 2>/dev/null || true

    if command -v node &> /dev/null; then
        npm config set registry https://registry.npmmirror.com 2>/dev/null || true
        log_success "Node.js 安装完成: $(node -v)  npm $(npm -v 2>/dev/null)"
    else
        log_error "安装后未找到 node 命令，可能 /usr/local/bin 不在 PATH 中"
        add_missing "Node.js 未安装：请确认 /usr/local/bin 在 PATH 后重新运行部署"
        return 1
    fi
}

# 安装 MongoDB
install_mongodb() {
    log_step "检查并安装 MongoDB"
    if command -v mongod &> /dev/null; then
        log_info "MongoDB 已安装"
        return
    fi
    echo "  1) 安装 MongoDB Community Server (本地)"
    echo "  2) 使用 MongoDB Atlas (云数据库)"
    echo "  3) 跳过"
    choice=$(ask_option "请选择 [1-3]: " "1")
    case $choice in
        1)
            if check_avx2; then
                MONGODB_VERSION="7.0"
                install_mongodb_local "$MONGODB_VERSION"
            else
                # 不支持 AVX2：锁定 4.4。Ubuntu 22.04+ 官方无 4.4 的 apt 包且缺 libssl1.1，
                # 无法原生安装，改用 Docker 容器运行 mongo:4.4。
                log_warn "CPU 不支持 AVX2，MongoDB 锁定 4.4，将通过 Docker 安装"
                install_mongodb_docker "4.4"
            fi
            ;;
        2) log_info "请访问 https://www.mongodb.com/atlas/database 创建免费集群";;
        3) log_info "跳过 MongoDB 安装";;
    esac
}

install_mongodb_local() {
    local version="$1"
    log_info "安装 MongoDB $version ..."
    case $OS in
        ubuntu)
            # GPG 公钥为 MongoDB 官方签名密钥（清华镜像不托管签名密钥，必须保留官方地址用于校验）
            curl -fsSL "https://www.mongodb.org/static/pgp/server-${version}.asc" | $SUDO gpg -o "/usr/share/keyrings/mongodb-server-${version}.gpg" --dearmor
            # 软件包改用清华大学开源镜像站，避免直连官方源 repo.mongodb.org
            echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-${version}.gpg ] https://mirrors.tuna.tsinghua.edu.cn/mongodb/apt/ubuntu $(lsb_release -cs)/mongodb-org/${version} multiverse" | $SUDO tee "/etc/apt/sources.list.d/mongodb-org-${version}.list"
            $SUDO apt update -qq
            $SUDO apt install -y mongodb-org
            ;;
        debian)
            curl -fsSL "https://www.mongodb.org/static/pgp/server-${version}.asc" | $SUDO gpg -o "/usr/share/keyrings/mongodb-server-${version}.gpg" --dearmor
            echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-${version}.gpg ] https://mirrors.tuna.tsinghua.edu.cn/mongodb/apt/debian $(lsb_release -cs)/mongodb-org/${version} multiverse" | $SUDO tee "/etc/apt/sources.list.d/mongodb-org-${version}.list"
            $SUDO apt update -qq
            $SUDO apt install -y mongodb-org
            ;;
        centos|rhel|rocky|alma)
            cat <<EOF | $SUDO tee "/etc/yum.repos.d/mongodb-org-${version}.repo"
[mongodb-org-${version}]
name=MongoDB Repository
# 阿里云 MongoDB 镜像（https://mirrors.aliyun.com/mongodb），避免直连官方源 repo.mongodb.org
baseurl=https://mirrors.aliyun.com/mongodb/yum/redhat/\$releasever/mongodb-org/${version}/x86_64/
gpgcheck=1
enabled=1
gpgkey=https://www.mongodb.org/static/pgp/server-${version}.asc
EOF
            $SUDO yum install -y mongodb-org
            ;;
    esac
    if command -v systemctl &> /dev/null && systemctl --no-pager status >/dev/null 2>&1; then
        $SUDO systemctl start mongod
        $SUDO systemctl enable mongod
    else
        # WSL 等无 systemd 环境：用 service 兜底
        $SUDO service mongod start >/dev/null 2>&1 || true
    fi
    log_info "等待 MongoDB 启动..."
    for i in {1..30}; do
        if nc -z localhost 27017 2>/dev/null; then
            log_success "MongoDB 已就绪"
            return
        fi
        sleep 2
    done
    log_warn "MongoDB 启动超时，请手动检查"
}

# 启动 Docker 守护进程（兼容 systemd 与无 systemd 的 WSL）
start_docker_daemon() {
    if docker info >/dev/null 2>&1; then
        return 0
    fi
    log_info "Docker 守护进程未运行，尝试启动..."
    if command -v systemctl &> /dev/null && systemctl --no-pager status >/dev/null 2>&1; then
        $SUDO systemctl start docker >/dev/null 2>&1 || true
        $SUDO systemctl enable docker >/dev/null 2>&1 || true
    else
        $SUDO service docker start >/dev/null 2>&1 || true
    fi
    for i in $(seq 1 15); do
        docker info >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

# 配置 Docker 国内镜像加速（避免拉取 mongo:4.4 被墙）
configure_docker_mirror() {
    local daemon_json="/etc/docker/daemon.json"
    if [[ -f "$daemon_json" ]] && grep -q "registry-mirrors" "$daemon_json" 2>/dev/null; then
        return 0
    fi
    log_info "配置 Docker 国内镜像加速..."
    $SUDO mkdir -p /etc/docker
    $SUDO tee "$daemon_json" >/dev/null <<'DOCKEOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.m.daocloud.io",
    "https://hub-mirror.c.163.com"
  ]
}
DOCKEOF
    # 重启守护进程使镜像加速生效
    if command -v systemctl &> /dev/null && systemctl --no-pager status >/dev/null 2>&1; then
        $SUDO systemctl restart docker >/dev/null 2>&1 || true
    else
        $SUDO service docker restart >/dev/null 2>&1 || true
    fi
    sleep 2
}

# 安装 Docker（纯净系统必备）：优先 apt/yum 的发行版包，配国内镜像加速
install_docker() {
    if command -v docker &> /dev/null; then
        log_info "Docker 已安装: $(docker --version 2>/dev/null)"
        configure_docker_mirror
        start_docker_daemon || log_warn "Docker 守护进程启动失败，请手动检查"
        return 0
    fi

    log_step "安装 Docker"
    case $PKG_MANAGER in
        apt)
            # 统一使用阿里云 Docker CE 镜像源（https://mirrors.aliyun.com/docker-ce），避免直连 Docker 官方源 download.docker.com
            local dver
            case $OS in
                ubuntu) dver="ubuntu" ;;
                debian) dver="debian" ;;
                *) dver="ubuntu" ;;
            esac
            local codename
            codename="$(. /etc/os-release 2>/dev/null; echo "${VERSION_CODENAME:-}")"
            [[ -z "$codename" ]] && codename="$(lsb_release -cs 2>/dev/null)"
            $SUDO install -m 0755 -d /etc/apt/keyrings 2>/dev/null || true
            if curl -fsSL "https://mirrors.aliyun.com/docker-ce/linux/$dver/gpg" | $SUDO gpg -o /etc/apt/keyrings/docker.gpg --dearmor 2>/dev/null; then
                echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.aliyun.com/docker-ce/linux/$dver $codename stable" | $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null
                $SUDO apt update -qq || true
                if $SUDO apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin; then
                    log_success "Docker 安装完成（Docker CE，阿里云镜像）"
                else
                    log_error "Docker 安装失败，请手动安装后重试"
                    add_missing "Docker 安装失败：请手动安装 docker 后重新运行部署"
                    return 1
                fi
            else
                log_warn "阿里云 Docker GPG 拉取失败，回退到发行版自带 docker.io"
                $SUDO apt update -qq || true
                if $SUDO apt install -y docker.io docker-compose-v2; then
                    log_success "Docker 安装完成（docker.io 回退）"
                else
                    log_error "Docker 安装失败，请手动安装后重试"
                    add_missing "Docker 安装失败：请手动安装 docker 后重新运行部署"
                    return 1
                fi
            fi
            ;;
        yum|dnf)
            $SUDO $PKG_MANAGER install -y yum-utils || true
            $SUDO $PKG_MANAGER-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null || true
            if $SUDO $PKG_MANAGER install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin; then
                log_success "Docker 安装完成（docker-ce）"
            else
                log_error "Docker 安装失败，请手动安装后重试"
                add_missing "Docker 安装失败：请手动安装 docker-ce 后重新运行部署"
                return 1
            fi
            ;;
        *)
            log_error "未知包管理器，无法自动安装 Docker"
            add_missing "Docker 未安装：请手动安装后重新运行部署"
            return 1
            ;;
    esac

    # 把当前用户加入 docker 组（非 root 时免 sudo 用 docker，需重新登录生效）
    if [[ -n "$SUDO" ]] && getent group docker >/dev/null 2>&1; then
        $SUDO usermod -aG docker "$USER" 2>/dev/null || true
        log_info "已将 $USER 加入 docker 组（需重新登录后免 sudo 使用 docker）"
    fi

    configure_docker_mirror
    if ! start_docker_daemon; then
        log_warn "Docker 守护进程启动失败，请手动执行: sudo service docker start"
        return 1
    fi
    log_success "Docker 守护进程已就绪"
    return 0
}

# 通过 Docker 安装并启动 MongoDB
# 适用场景：CPU 不支持 AVX2（锁定 4.4），或 Ubuntu 22.04+ 官方无 4.4 apt 包（缺 libssl1.1）无法原生安装
install_mongodb_docker() {
    local version="$1"
    log_step "通过 Docker 安装 MongoDB $version"

    # 清理可能残留的官方 mongo apt 源（如之前失败安装留下的 mongodb-org-4.4.list），
    # 否则每次 apt update 都会被它毒到而失败。
    for f in /etc/apt/sources.list.d/mongodb-org-*.list; do
        if [[ -f "$f" ]]; then
            log_warn "发现残留 mongo apt 源 $f，已清除（改用 Docker，不需要它）"
            $SUDO rm -f "$f"
        fi
    done

    # 纯净系统没有 Docker：自动安装（这是无 AVX2 机器跑 4.4 的必经之路）
    if ! command -v docker &> /dev/null; then
        log_warn "未检测到 Docker，MongoDB 4.4 需以容器运行，开始自动安装 Docker..."
        if ! install_docker; then
            log_error "Docker 自动安装失败，无法以容器方式运行 MongoDB"
            add_missing "MongoDB 未安装：请手动安装 Docker 后运行 'docker compose up -d'"
            return 1
        fi
    fi

    # 确保 docker 守护进程已启动（WSL 下常需手动拉起）
    if ! docker info >/dev/null 2>&1; then
        start_docker_daemon || log_warn "Docker 守护进程启动失败，请手动检查"
    fi

    if [[ -f "docker-compose.yml" ]] && docker compose version >/dev/null 2>&1; then
        log_info "使用项目自带 docker-compose.yml 启动 MongoDB ..."
        $SUDO docker compose up -d mongodb 2>/dev/null || docker compose up -d mongodb
    else
        [[ -f "docker-compose.yml" ]] || log_warn "未找到项目 docker-compose.yml"
        docker compose version >/dev/null 2>&1 || log_warn "无 compose 插件，改用 docker run"
        log_info "直接拉取并运行 mongo:$version ..."
        $SUDO docker rm -f "mongodb${version//.}" >/dev/null 2>&1 || true
        $SUDO docker run -d --name "mongodb${version//.}" -p 27017:27017 \
            -v "mongodb${version//.}-data:/data/db" --restart unless-stopped "mongo:$version" 2>/dev/null || \
        docker run -d --name "mongodb${version//.}" -p 27017:27017 \
            -v "mongodb${version//.}-data:/data/db" --restart unless-stopped "mongo:$version"
    fi

    log_info "等待 MongoDB 启动..."
    for i in $(seq 1 30); do
        if command -v nc &> /dev/null && nc -z localhost 27017 2>/dev/null; then
            log_success "MongoDB (Docker) 已就绪"
            return 0
        fi
        sleep 2
    done
    log_warn "MongoDB 启动超时，请手动检查: docker logs mongodb${version//.}"
}

# 安装 Redis
install_redis() {
    log_step "检查并安装 Redis"
    if command -v redis-server &> /dev/null; then
        log_info "Redis 已安装"
        return
    fi
    if ask_yes_no "是否安装 Redis？(用于缓存，可选) [y/N]: " "N"; then
        case $PKG_MANAGER in
            apt) $SUDO apt install -y redis-server ;;
            yum|dnf) $SUDO $PKG_MANAGER install -y redis ;;
        esac
        if command -v systemctl &> /dev/null && systemctl --no-pager status >/dev/null 2>&1; then
            $SUDO systemctl start redis
            $SUDO systemctl enable redis
        else
            $SUDO service redis-server start >/dev/null 2>&1 || $SUDO service redis start >/dev/null 2>&1 || true
        fi
        log_success "Redis 安装完成"
    fi
}

# 生成随机密钥
generate_secret() {
    openssl rand -base64 48 | tr -d '\n'
}

# 全局变量记录缺失配置
MISSING_CONFIGS=()
add_missing() { MISSING_CONFIGS+=("$1"); }

# 交互式配置项目
configure_project() {
    log_step "配置项目环境"
    
    if [[ ! -f "server.js" ]] || [[ ! -f "package.json" ]]; then
        log_error "当前目录未找到 server.js 或 package.json，请确保在项目根目录下执行"
        exit 1
    fi

    log_info "安装项目依赖..."
    if ! npm install; then
        log_warn "npm install 失败，请检查 Node 是否安装正确或网络是否通畅"
        add_missing "项目依赖(npm install)安装失败，请手动执行 npm install 后重新部署"
    fi
    mkdir -p data

    # 询问是否覆盖已有配置
    local overwrite_env=false
    local overwrite_config=false
    if [[ -f ".env" ]]; then
        if ask_yes_no "检测到已有 .env 文件，是否覆盖重新配置？ [y/N]: " "N"; then
            overwrite_env=true
        fi
    else
        overwrite_env=true
    fi

    if [[ -f "data/config.json" ]]; then
        if ask_yes_no "检测到已有 data/config.json，是否覆盖重新配置？ [y/N]: " "N"; then
            overwrite_config=true
        fi
    else
        overwrite_config=true
    fi

    # 让用户选择是否现在填写管理员/学校信息（可跳过，稍后手动配置）
    local do_interactive_config=true
    if is_interactive && [[ "$overwrite_config" == "true" ]]; then
        if ! ask_yes_no "是否现在配置管理员与学校信息（可跳过，稍后手动编辑 data/config.json）？ [Y/n]: " "Y"; then
            do_interactive_config=false
            log_info "已跳过管理员/学校配置，安装完成后可手动编辑 data/config.json"
        fi
    fi

    # --- 收集 .env 配置 ---
    # 端口统一为 2080（与代码默认端口 src/config/constants.js 一致，避免 CORS/端口分裂）
    local port="2080"
    local node_env="production"
    local mongodb_uri="mongodb://localhost:27017/school-forum"
    local mongodb_username=""
    local mongodb_password=""
    local mongodb_authsource="admin"
    local redis_host="localhost"
    local redis_port=6379
    local redis_password=""
    local jwt_secret=""
    local admin_jwt_secret=""
    local smtp_host=""
    local smtp_port=""
    local smtp_secure="true"
    local smtp_user=""
    local smtp_pass=""
    local cors_origin="http://localhost:2080"

    if [[ "$overwrite_env" == "true" ]] && is_interactive; then
        print_section "基础配置"
        while true; do
            prompt_read port "服务端口 (默认: 2080): " "2080"
            if validate_positive_int "$port"; then
                break
            else
                log_warn "端口必须是正整数，请重新输入"
            fi
        done
        prompt_read node_env "运行环境 (development/production, 默认: production): " "production"

        print_section "MongoDB 配置"
        prompt_read input_uri "MongoDB 连接字符串 (默认: mongodb://localhost:27017/school-forum): " "$mongodb_uri"
        mongodb_uri=${input_uri:-$mongodb_uri}
        prompt_read mongodb_username "MongoDB 用户名 (若无需认证请留空): " ""
        if [[ -n "$mongodb_username" ]]; then
            prompt_read mongodb_password "MongoDB 密码: " "" "silent"
            prompt_read mongodb_authsource "认证数据库 (默认: admin): " "admin"
            mongodb_authsource=${mongodb_authsource:-admin}
        fi

        print_section "Redis 配置"
        prompt_read input_host "Redis 主机 (默认: localhost): " "$redis_host"
        redis_host=${input_host:-$redis_host}
        while true; do
            prompt_read input_port "Redis 端口 (默认: 6379): " "6379"
            redis_port=${input_port:-6379}
            if validate_positive_int "$redis_port"; then
                break
            else
                log_warn "端口必须是正整数"
            fi
        done
        prompt_read redis_password "Redis 密码 (若无请留空): " "" "silent"

        print_section "JWT 安全配置"
        # 优先保留已有 JWT 密钥：更新部署时不再强制重置，避免全站 token 失效/用户被登出
        local existing_jwt=""
        local existing_admin_jwt=""
        if [[ -f .env ]]; then
            existing_jwt=$(grep -E '^JWT_SECRET=' .env | head -1 | cut -d'=' -f2- | tr -d '\r')
            existing_admin_jwt=$(grep -E '^ADMIN_JWT_SECRET=' .env | head -1 | cut -d'=' -f2- | tr -d '\r')
        fi
        jwt_secret="${existing_jwt:-$(generate_secret)}"
        admin_jwt_secret="${existing_admin_jwt:-$(generate_secret)}"
        prompt_read manual_jwt "是否手动指定 JWT_SECRET？(已有密钥将保留，仅更换时选择) [y/N]: " "N"
        if [[ "$manual_jwt" =~ ^[Yy]$ ]]; then
            prompt_read jwt_secret "请输入 JWT_SECRET (至少32字符): " ""
            prompt_read admin_jwt_secret "请输入 ADMIN_JWT_SECRET: " ""
        elif [[ -n "$existing_jwt" ]]; then
            log_info "已保留现有 JWT_SECRET（如需更换请选择手动指定或编辑 .env）"
        fi

        print_section "邮件服务配置（可选）"
        prompt_read smtp_host "SMTP 服务器 (例如 smtp.163.com, 留空跳过): " ""
        if [[ -n "$smtp_host" ]]; then
            while true; do
                prompt_read smtp_port "SMTP 端口 (465/587, 默认: 465): " "465"
                smtp_port=${smtp_port:-465}
                if validate_positive_int "$smtp_port"; then
                    break
                else
                    log_warn "端口必须是数字"
                fi
            done
            prompt_read smtp_secure "是否使用 SSL/TLS? (true/false, 默认 true): " "true"
            smtp_secure=${smtp_secure:-true}
            prompt_read smtp_user "邮箱账号: " ""
            prompt_read smtp_pass "邮箱授权码/密码: " "" "silent"
        else
            add_missing "邮件服务 (SMTP) 未配置，如需发送邮件请编辑 .env 中的 SMTP_* 配置"
        fi

        print_section "QQ 快捷登录（可选功能，默认不启用）"
        log_info "说明：QQ 快捷登录是可选功能，不配置则完全不影响系统，登录页仅使用邮箱注册/登录。"
        log_info "如要启用，需先在 QQ 互联 (https://connect.qq.com) 申请网站应用，然后在此填写。"
        prompt_read qq_enable "是否启用 QQ 快捷登录？(y/N，默认不启用): " "N"
        if [[ "$qq_enable" =~ ^[Yy]$ ]]; then
            prompt_read qq_app_id "QQ 互联 AppID: " ""
            prompt_read qq_app_secret "QQ 互联 AppSecret: " "" "silent"
            prompt_read qq_redirect_uri "授权回调地址 (必须与QQ互联后台一致, 例如 https://域名/api/auth/qq/callback): " ""
            add_missing "QQ_APP_ID=$qq_app_id"
            add_missing "QQ_APP_SECRET=$qq_app_secret"
            add_missing "QQ_REDIRECT_URI=$qq_redirect_uri"
            log_info "✅ QQ 快捷登录已启用，登录页将显示 QQ 登录按钮"
        else
            log_info "QQ 快捷登录未启用（默认），登录页保持邮箱注册/登录。"
            log_info "如以后需要启用，编辑 .env 填写 QQ_APP_ID/QQ_APP_SECRET/QQ_REDIRECT_URI 后重启服务即可。"
            add_missing "# QQ 快捷登录（可选功能，默认不启用；启用需在 QQ 互联 connect.qq.com 申请应用）"
            add_missing "QQ_APP_ID="
            add_missing "QQ_APP_SECRET="
            add_missing "QQ_REDIRECT_URI="
        fi

        print_section "CORS 白名单"
        prompt_read cors_origin "CORS 白名单 (多个用逗号分隔, 默认 http://localhost:2080): " "http://localhost:2080"

        print_section "服务器 IP"
        prompt_read server_ip "服务器内网IP (例如192.168.2.4, 留空自动检测): " ""
        if [[ -z "$server_ip" ]]; then
            server_ip=$(hostname -I 2>/dev/null | awk '{print $1}')
            [[ -n "$server_ip" ]] && log_info "自动检测到服务器 IP: $server_ip"
        fi
    elif [[ "$overwrite_env" == "true" ]] && ! is_interactive; then
        # 非交互模式：仅在 .env 不存在或没有现有密钥时生成（已有则保留）
        if [[ -z "$jwt_secret" ]]; then
            jwt_secret=$(generate_secret)
            admin_jwt_secret=$(generate_secret)
        fi
    fi

    # 写入 .env
    if [[ "$overwrite_env" == "true" ]]; then
        log_info "生成 .env 配置文件..."
        # 转义敏感值中的特殊字符，防止 heredoc 二次展开（$、反引号等）破坏配置或注入
        esc_env() { printf '%s' "$1" | sed 's/[$`"\\]/\\&/g'; }
        local esc_mongodb_uri esc_mongodb_password esc_redis_password esc_jwt_secret esc_admin_jwt_secret
        local esc_smtp_user esc_smtp_pass esc_cors_origin esc_server_ip
        esc_mongodb_uri=$(esc_env "$mongodb_uri")
        esc_mongodb_password=$(esc_env "$mongodb_password")
        esc_redis_password=$(esc_env "$redis_password")
        esc_jwt_secret=$(esc_env "$jwt_secret")
        esc_admin_jwt_secret=$(esc_env "$admin_jwt_secret")
        esc_smtp_user=$(esc_env "$smtp_user")
        esc_smtp_pass=$(esc_env "$smtp_pass")
        esc_cors_origin=$(esc_env "$cors_origin")
        esc_server_ip=$(esc_env "${server_ip:-}")
        # umask 077 建文件：.env 含 JWT 密钥与数据库口令，不能先以 644 落盘再等脚本末尾 chmod
        # （中途中断就永久停在 644，任何本机用户可读）
        (umask 077; cat > .env <<EOF
# ===========================================
# 校园论坛运行配置（由部署脚本自动生成）
# ===========================================

PORT=$port
NODE_ENV=$node_env

MONGODB_URI=$esc_mongodb_uri
MONGODB_USERNAME=$mongodb_username
MONGODB_PASSWORD=$esc_mongodb_password
MONGODB_AUTHSOURCE=$mongodb_authsource
MONGODB_TLS=false
MONGODB_SERVER_SELECTION_TIMEOUT=10000
MONGODB_CONNECT_TIMEOUT=10000
MONGODB_SOCKET_TIMEOUT=30000
MONGODB_MAX_POOL_SIZE=10
MONGODB_MIN_POOL_SIZE=2

REDIS_HOST=$redis_host
REDIS_PORT=$redis_port
REDIS_PASSWORD=$esc_redis_password
REDIS_CONNECT_TIMEOUT=5000
REDIS_COMMAND_TIMEOUT=3000

JWT_SECRET=$esc_jwt_secret
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d

ADMIN_JWT_SECRET=$esc_admin_jwt_secret
ADMIN_JWT_EXPIRES_IN=24h

SMTP_HOST=$smtp_host
SMTP_PORT=$smtp_port
SMTP_SECURE=$smtp_secure
SMTP_USER=$esc_smtp_user
SMTP_PASS=$esc_smtp_pass

CORS_ORIGIN=$esc_cors_origin
SERVER_IP=$esc_server_ip

MAX_REQUEST_SIZE=10
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_TIME=1800000

PASSWORD_MIN_LENGTH=8
PASSWORD_REQUIRE_UPPERCASE=true
PASSWORD_REQUIRE_LOWERCASE=true
PASSWORD_REQUIRE_NUMBER=true
PASSWORD_REQUIRE_SPECIAL=false

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EOF
        )
        chmod 600 .env 2>/dev/null || true
        log_success ".env 已生成（权限 600）"
    else
        log_info "保留现有 .env 文件"
    fi

    # --- 收集 data/config.json 配置 ---
    local admin_users_json="[]"
    local schools_json="[]"

    if [[ "$overwrite_config" == "true" ]] && is_interactive && [[ "$do_interactive_config" == "true" ]]; then
        print_section "管理员配置"
        echo "请输入管理员 QQ 号（每行一个，输入空行结束）："
        local admin_users=()
        while true; do
            prompt_read qq "QQ号: " ""
            if [[ -z "$qq" ]]; then
                break
            elif validate_qq "$qq"; then
                admin_users+=("$qq")
            else
                log_warn "无效 QQ 号，请重新输入 (5-15位数字)"
            fi
        done
        if [[ ${#admin_users[@]} -eq 0 ]]; then
            add_missing "管理员 QQ 号未配置，请编辑 data/config.json 中的 adminUsers 数组"
        else
            admin_users_json=$(printf '%s\n' "${admin_users[@]}" | jq -R . | jq -s .)
        fi

        print_section "学校配置"
        local schools=()
        while true; do
            prompt_read add_school "是否添加/编辑学校信息？ [y/N]: " "N"
            if [[ ! "$add_school" =~ ^[Yy]$ ]]; then
                break
            fi
            prompt_read school_id "学校 ID (例如 XXXX): " ""
            prompt_read school_name "学校名称 (例如 XX学校): " ""
            local class_info=()
            echo "现在为该学校添加年级班级信息 (例如: 2020年级有18个班)"
            while true; do
                prompt_read add_class "添加年级班级？ [y/N]: " "N"
                if [[ ! "$add_class" =~ ^[Yy]$ ]]; then
                    break
                fi
                local year=""
                while true; do
                    prompt_read year "年份 (例如 2020): " ""
                    if validate_year "$year"; then
                        break
                    else
                        log_warn "年份必须是4位数字 (2000-2100)"
                    fi
                done
                local class_count=""
                while true; do
                    prompt_read class_count "班级数量: " ""
                    if validate_positive_int "$class_count"; then
                        break
                    else
                        log_warn "班级数量必须是正整数"
                    fi
                done
                class_info+=("{\"year\": $year, \"classCount\": $class_count}")
            done
            local class_json="[]"
            if [[ ${#class_info[@]} -gt 0 ]]; then
                class_json=$(IFS=,; echo "[${class_info[*]}]")
            fi
            schools+=("{\"id\": \"$school_id\", \"name\": \"$school_name\", \"classInfo\": $class_json}")
        done
        if [[ ${#schools[@]} -eq 0 ]]; then
            add_missing "未配置学校信息，如需支持学校班级选择，请编辑 data/config.json 中的 schools 数组"
        else
            schools_json=$(IFS=,; echo "[${schools[*]}]")
        fi
    elif [[ "$overwrite_config" == "true" ]]; then
        # 非交互模式，或用户在交互模式下主动选择跳过配置
        admin_users_json="[]"
        schools_json="[]"
        if [[ -n "${SCHOOL_FORUM_ADMIN_QQ:-}" ]]; then
            # 非交互模式下通过环境变量预填管理员（逗号分隔多个 QQ）
            local qq_list qq_clean valid_qqs=()
            IFS=',' read -ra qq_list <<< "$SCHOOL_FORUM_ADMIN_QQ"
            for q in "${qq_list[@]}"; do
                qq_clean="$(echo "$q" | tr -d '[:space:]')"
                if validate_qq "$qq_clean"; then
                    valid_qqs+=("$qq_clean")
                fi
            done
            if [[ ${#valid_qqs[@]} -gt 0 ]]; then
                admin_users_json=$(printf '%s\n' "${valid_qqs[@]}" | jq -R . | jq -s .)
                log_info "已从环境变量 SCHOOL_FORUM_ADMIN_QQ 预填 ${#valid_qqs[@]} 个管理员"
            fi
        fi
        if is_interactive; then
            log_info "已跳过学校与管理员配置，可稍后编辑 data/config.json"
        else
            add_missing "管理员与学校信息未配置（非交互模式自动跳过），可手动编辑 data/config.json 中的 adminUsers / schools"
        fi
    fi

    # 写入 data/config.json
    if [[ "$overwrite_config" == "true" ]]; then
        log_info "生成 data/config.json 配置文件..."
        # 确保转义变量可用（overwrite_env=false 时上面未定义，这里重新计算）
        esc_env() { printf '%s' "$1" | sed 's/[$`"\\]/\\&/g'; }
        local esc_mongodb_uri esc_mongodb_password esc_redis_password
        esc_mongodb_uri=$(esc_env "$mongodb_uri")
        esc_mongodb_password=$(esc_env "$mongodb_password")
        esc_redis_password=$(esc_env "$redis_password")
        # 同样用 umask 077：config.json 里含 MongoDB/Redis 口令
        (umask 077; cat > data/config.json <<EOF
{
  "adminUsers": $admin_users_json,
  "mongodb": {
    "uri": "$esc_mongodb_uri",
    "username": "$mongodb_username",
    "password": "$esc_mongodb_password",
    "authSource": "$mongodb_authsource"
  },
  "redis": {
    "host": "$redis_host",
    "port": $redis_port,
    "password": "$esc_redis_password",
    "db": 0
  },
  "upload": {
    "allowedTypes": ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"],
    "maxFileSize": 33554432,
    "maxFiles": 32
  },
  "password": {
    "saltRounds": 10
  },
  "pagination": {
    "defaultPage": 1,
    "defaultLimit": 100
  },
  "contentLimits": {
    "post": 10000,
    "comment": 500,
    "username": { "min": 2, "max": 20 },
    "qq": { "min": 5, "max": 15 },
    "password": { "min": 6 }
  },
  "schools": $schools_json
}
EOF
        )
        chmod 600 data/config.json 2>/dev/null || true
        log_success "data/config.json 已生成（权限 600）"
        # 验证 JSON 合法性
        if command -v jq &> /dev/null; then
            if ! jq empty data/config.json 2>/dev/null; then
                log_error "生成的 JSON 无效，请检查输入（尤其是班级数量应为数字）"
                log_warn "将保留当前文件，请手动修正"
            fi
        fi
        if [[ "$admin_users_json" == "[]" ]]; then
            log_warn "未配置管理员，请稍后手动编辑 data/config.json 添加 adminUsers"
        fi
    else
        log_info "保留现有 data/config.json 文件"
    fi

    if [[ -f ".env" ]]; then
        chmod 600 .env 2>/dev/null || true
    fi
    if [[ -f "data/config.json" ]]; then
        chmod 600 data/config.json 2>/dev/null || true
    fi
}

# 安装 PM2
install_pm2() {
    log_step "安装 PM2 (进程管理器)"
    
    if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
        source "$HOME/.nvm/nvm.sh"
    fi

    local npm_prefix="$HOME/.npm-global"
    mkdir -p "$npm_prefix"
    export NPM_CONFIG_PREFIX="$npm_prefix"
    npm config set prefix "$npm_prefix" --global 2>/dev/null || true

    export PATH="$npm_prefix/bin:$PATH"
    if ! grep -q "$npm_prefix/bin" "$HOME/.bashrc" 2>/dev/null; then
        echo "export PATH=\"$npm_prefix/bin:\$PATH\"" >> "$HOME/.bashrc"
    fi

    if command -v pm2 &> /dev/null; then
        log_info "PM2 已安装: $(which pm2)"
        return
    fi

    log_info "正在安装 PM2（这可能需要几分钟）..."
    if npm install -g pm2; then
        log_success "PM2 安装完成"
    else
        log_error "PM2 安装失败，请手动执行以下命令："
        echo "  export NPM_CONFIG_PREFIX=\"\$HOME/.npm-global\""
        echo "  export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
        echo "  npm install -g pm2"
        echo "然后重新运行: pm2 start server.js --name school-forum"
        return 1
    fi

    if command -v pm2 &> /dev/null; then
        log_success "pm2 命令可用: $(which pm2)"
    else
        log_warn "pm2 命令暂时不可用，请执行 'source ~/.bashrc' 或重新登录"
    fi
}

# 启动服务
start_service() {
    if ask_yes_no "是否现在启动论坛服务？ [Y/n]: " "Y"; then
        if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
            source "$HOME/.nvm/nvm.sh"
        fi
        export PATH="$HOME/.npm-global/bin:$PATH"

        if command -v pm2 &> /dev/null; then
            if pm2 start server.js --name school-forum; then
                log_success "服务已启动 (PM2)"
                pm2 save
                pm2 startup &> /dev/null || true
            else
                log_error "PM2 启动失败，请手动运行 'npm start' 检查错误"
            fi
        else
            log_warn "pm2 命令未找到，尝试使用 npm start 前台运行"
            log_warn "按 Ctrl+C 停止服务，建议稍后重新登录再试 PM2"
            npm start
        fi
    fi
}

# 完成提示
show_complete() {
    echo ""
    echo -e "${GREEN}========================================================${NC}"
    echo -e "${GREEN}                      部署完成！${NC}"
    echo -e "${GREEN}========================================================${NC}"
    echo ""
    
    if [[ ${#MISSING_CONFIGS[@]} -gt 0 ]]; then
        echo -e "${YELLOW}[WARN] 以下配置项尚未填写，请手动配置后再使用论坛：${NC}"
        for item in "${MISSING_CONFIGS[@]}"; do
            echo "  - $item"
        done
        echo ""
        echo -e "${YELLOW}配置文件位置：${NC}"
        echo "  环境变量: $(pwd)/.env"
        echo "  业务配置: $(pwd)/data/config.json"
        echo ""
    else
        echo -e "${GREEN}[SUCCESS] 所有必需配置已填写完整，论坛可立即使用。${NC}"
        echo ""
    fi
    
    echo -e "${CYAN}后续步骤：${NC}"
    echo "  1. 如需邮件功能，确认 SMTP 配置正确"
    echo "  2. 检查 .env 和 data/config.json 中其他可选配置"
    echo ""
    echo -e "${CYAN}常用命令：${NC}"
    echo "  pm2 start server.js --name school-forum   # 启动"
    echo "  pm2 logs school-forum                     # 查看日志"
    echo "  pm2 restart school-forum                  # 重启"
    echo "  pm2 stop school-forum                     # 停止"
    echo ""
    echo -e "${BOLD}访问论坛: ${GREEN}http://localhost:$(grep ^PORT .env 2>/dev/null | cut -d= -f2 || echo 3000)${NC}"
    echo ""
}

# 主函数
main() {
    print_banner
    check_root
    detect_os

    if ask_yes_no "是否配置清华镜像加速下载？(推荐) [Y/n]: " "Y"; then
        smart_switch_mirror || true
    fi

    if ask_yes_no "是否更新系统与已有软件包（apt upgrade / dnf upgrade）？(推荐) [Y/n]: " "Y"; then
        update_system || true
    fi

    # 各安装步骤尽量容错：即使某项失败也不阻断后续（尤其保证 configure_project 一定会执行，让用户完成配置）
    install_tools || { log_error "基础工具安装失败，无法继续"; exit 1; }
    install_nodejs || add_missing "Node.js 安装失败，论坛将无法启动"
    install_mongodb || add_missing "MongoDB 安装失败，请手动处理"
    install_redis || true
    configure_project
    install_pm2 || add_missing "PM2 安装失败，可用 'npm start' 启动"
    start_service || true
    show_complete
}

main "$@"