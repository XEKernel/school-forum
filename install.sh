#!/bin/bash

# =======================================================
# 校园论坛系统 - 一键在线安装 / 更新脚本（单文件）
#
# 功能：
#   - 从 GitHub Releases 下载构建好的部署包（含生产依赖，开箱即用）
#   - 解压后调用包内 deploy.sh 完成环境安装与配置部署
#   - 检查是否有新版本，并可一键更新（保留 .env 与 data/config.json）
#   - 国内网络受限时自动走代理镜像下载
#
# 用法：
#   bash install.sh                 # 安装最新版本（下载 -> 解压 -> 部署）
#   bash install.sh check           # 只检查是否有新版本，不做任何改动
#   bash install.sh update          # 更新到最新版本（保留现有配置后重新部署）
#   bash install.sh install         # 同默认，安装最新版本
#   bash install.sh -v <tag>        # 安装指定版本，如 -v v1.0.0-build.12
#   bash install.sh -d <dir>        # 指定安装目录（默认 ~/school-forum）
#   bash install.sh --proxy <url>   # 强制指定镜像源/代理前缀（--mirror 同义）
#   bash install.sh --no-deploy     # 只下载解压，不自动跑 deploy.sh
#   bash install.sh -h              # 帮助
# =======================================================

set -uo pipefail

# ---------------- 基本配置 ----------------
REPO="XEKernel/school-forum"
ASSET="school-forum-linux-deploy.tar.gz"
INSTALL_DIR_DEFAULT="$HOME/school-forum"

# 国内下载镜像源/代理前缀（直连 GitHub 失败时依次尝试，直接拼在完整 github URL 前面）
# 注：mirror.ghproxy.com 与 gh.ddlc.top 已失效，已移除；如你的网络有可用镜像，用 --mirror <url> 指定
GH_PROXIES=(
    "https://v4.gh-proxy.org/"      # 优先：gh-proxy v4 镜像
    "https://gh-proxy.org/"         # 优先：gh-proxy 官方镜像
    ""                              # 次选：直连
    "https://ghproxy.net/"          # 镜像源
    "https://ghfast.top/"           # 镜像源（最后）
)

# ---------------- 颜色与日志 ----------------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
log_step()    { echo -e "\n${CYAN}--- $1 ---${NC}\n"; }

print_banner() {
    echo -e "${CYAN}"
    echo "========================================================"
    echo "        校园论坛系统 - 在线安装 / 更新脚本"
    echo "         从 GitHub Releases 下载并自动部署"
    echo "========================================================"
    echo -e "${NC}"
}

# ---------------- 运行时变量 ----------------
INSTALL_DIR="$INSTALL_DIR_DEFAULT"
TARGET_TAG=""          # 指定版本，空表示最新
FORCE_PROXY=""         # 强制代理前缀
DO_DEPLOY=true         # 下载后是否自动跑 deploy.sh
ACTION="install"       # install | update | check

# ---------------- 参数解析 ----------------
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            install|update|check) ACTION="$1"; shift ;;
            -v|--version) TARGET_TAG="${2:-}"; shift 2 ;;
            -d|--dir)     INSTALL_DIR="${2:-}"; shift 2 ;;
            --proxy|--mirror) FORCE_PROXY="${2:-}"; shift 2 ;;
            --no-deploy)  DO_DEPLOY=false; shift ;;
            -h|--help)    show_help; exit 0 ;;
            *) log_error "未知参数: $1"; show_help; exit 1 ;;
        esac
    done
}

show_help() {
    # 打印文件顶部用法注释块（第 4 行到闭合横线之间），去掉行首的 "# "
    sed -n '4,/^# ===/p' "$0" | sed 's/^# \{0,1\}//'
}

# ---------------- 依赖检查 ----------------
need_cmd() {
    command -v "$1" >/dev/null 2>&1
}

ensure_basic_tools() {
    if ! need_cmd curl; then
        log_warn "缺少 curl，尝试自动安装..."
        if need_cmd apt; then sudo apt update -qq && sudo apt install -y curl
        elif need_cmd yum; then sudo yum install -y curl
        elif need_cmd dnf; then sudo dnf install -y curl
        fi
    fi
    if ! need_cmd curl; then
        log_error "curl 不可用且无法自动安装，请先手动安装 curl 后重试"
        exit 1
    fi
    if ! need_cmd tar; then
        log_error "缺少 tar，请先安装 tar 后重试"
        exit 1
    fi
}

# ---------------- 版本查询 ----------------
# 取远端最新 release 的 tag_name
fetch_latest_tag() {
    local api="https://api.github.com/repos/$REPO/releases/latest"
    local json=""
    local proxies=("${GH_PROXIES[@]}")
    [[ -n "$FORCE_PROXY" ]] && proxies=("$FORCE_PROXY")
    for p in "${proxies[@]}"; do
        json=$(curl -fsSL --connect-timeout 10 "${p}${api}" 2>/dev/null) || json=""
        if [[ -n "$json" ]]; then
            local tag=""
            if need_cmd jq; then
                tag=$(echo "$json" | jq -r '.tag_name // empty' 2>/dev/null)
            else
                tag=$(echo "$json" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
            fi
            if [[ -n "$tag" && "$tag" != "null" ]]; then
                echo "$tag"
                return 0
            fi
        fi
    done
    return 1
}

# 读本地已安装版本的 TAG
get_local_tag() {
    local vf="$INSTALL_DIR/VERSION"
    if [[ -f "$vf" ]]; then
        grep -m1 '^TAG=' "$vf" | cut -d= -f2-
    else
        echo ""
    fi
}

# ---------------- 下载 ----------------
# 依次尝试镜像源/代理前缀下载指定 URL 到目标文件；成功返回 0
# 直连过慢（连续 speed-time 秒低于 speed-limit）时自动切换到下一个镜像源
# 参数: <url> <out> [check_type: gzip|raw, 默认 gzip] [prefer: 优先尝试的镜像源]
#   gzip -> 校验为有效 gzip 压缩包（用于部署包）；raw -> 仅校验文件非空（用于 sha256 等文本文件）
#   prefer -> 把已知可用的镜像源放最前，避免再次轮询全部镜像（用户要求：下载完就别换源）
LAST_OK_PROXY=""
download_with_proxies() {
    local url="$1" out="$2" check_type="${3:-gzip}" prefer="${4:-}"
    local proxies=("${GH_PROXIES[@]}")
    [[ -n "$FORCE_PROXY" ]] && proxies=("$FORCE_PROXY")
    if [[ -n "$prefer" ]]; then
        proxies=("$prefer" "${proxies[@]}")
    fi
    for p in "${proxies[@]}"; do
        local full="${p}${url}"
        [[ -z "$p" ]] && log_info "📥 尝试直连下载..." || log_info "📥 尝试镜像源: ${p%/}"
        # 进度条：--progress-bar 实时显示下载进度（演示更直观）
        # 过慢保护：连续 20s 低于 10KB/s 视为过慢 -> 放弃当前源、自动切下一个镜像源
        # 单源总时长上限 5 分钟，防止无限挂起
        if curl -fL --progress-bar \
                --connect-timeout 15 --retry 1 \
                --speed-limit 10240 --speed-time 20 --max-time 300 \
                -o "$out" "$full"; then
            if [[ "$check_type" == "gzip" ]]; then
                # 校验是有效 gzip 包（避免把 404 的 html 当成包）
                if gzip -t "$out" >/dev/null 2>&1; then
                    LAST_OK_PROXY="$p"
                    return 0
                fi
                log_warn "下载内容不是有效压缩包（可能被墙/镜像返回错误页），换下一个镜像源"
                rm -f "$out"
            else
                # raw：非压缩文本（如 sha256），仅校验非空即可
                if [[ -s "$out" ]]; then
                    LAST_OK_PROXY="$p"
                    return 0
                fi
                log_warn "下载内容为空，换下一个镜像源"
                rm -f "$out"
            fi
        else
            log_warn "该源下载失败或过慢，自动切换镜像源..."
            rm -f "$out"
        fi
    done
    return 1
}

# 根据 tag（空=latest）计算资产下载 URL
asset_url_for_tag() {
    local tag="$1"
    if [[ -z "$tag" ]]; then
        # latest 通道：GitHub 提供固定跳转
        echo "https://github.com/$REPO/releases/latest/download/$ASSET"
    else
        echo "https://github.com/$REPO/releases/download/$tag/$ASSET"
    fi
}

# ---------------- 动作：检查更新 ----------------
do_check() {
    log_step "检查版本"
    local local_tag remote_tag
    local_tag=$(get_local_tag)
    if [[ -n "$local_tag" ]]; then
        log_info "当前已安装版本: ${BOLD}$local_tag${NC}  (目录: $INSTALL_DIR)"
    else
        log_info "本地未检测到已安装版本 (目录: $INSTALL_DIR 无 VERSION 文件)"
    fi

    log_info "正在查询 GitHub Releases 最新版本..."
    if ! remote_tag=$(fetch_latest_tag); then
        log_error "无法获取远端版本（网络受限或仓库暂无 Release）"
        return 1
    fi
    log_info "远端最新版本: ${BOLD}$remote_tag${NC}"

    if [[ -z "$local_tag" ]]; then
        log_warn "尚未安装，可运行: bash install.sh install"
        return 0
    fi
    if [[ "$local_tag" == "$remote_tag" ]]; then
        log_success "已是最新版本，无需更新"
        return 0
    else
        log_warn "发现新版本！ $local_tag  ->  ${GREEN}$remote_tag${NC}"
        log_info "运行以下命令更新（会保留你的配置）:"
        echo "    bash install.sh update"
        return 0
    fi
}

# ---------------- 备份 / 恢复配置 ----------------
BACKUP_DIR=""
backup_config() {
    if [[ -f "$INSTALL_DIR/.env" || -f "$INSTALL_DIR/data/config.json" ]]; then
        BACKUP_DIR="$HOME/school-forum-config-backup-$(date +%Y%m%d-%H%M%S)"
        mkdir -p "$BACKUP_DIR/data"
        [[ -f "$INSTALL_DIR/.env" ]] && cp -a "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
        [[ -f "$INSTALL_DIR/data/config.json" ]] && cp -a "$INSTALL_DIR/data/config.json" "$BACKUP_DIR/data/config.json"
        log_info "已备份现有配置到: $BACKUP_DIR"
    fi
}
restore_config() {
    [[ -z "$BACKUP_DIR" ]] && return 0
    [[ -f "$BACKUP_DIR/.env" && ! -f "$INSTALL_DIR/.env" ]] && cp -a "$BACKUP_DIR/.env" "$INSTALL_DIR/.env"
    if [[ -f "$BACKUP_DIR/data/config.json" && ! -f "$INSTALL_DIR/data/config.json" ]]; then
        mkdir -p "$INSTALL_DIR/data"
        cp -a "$BACKUP_DIR/data/config.json" "$INSTALL_DIR/data/config.json"
    fi
}

# ---------------- 下载并解压 ----------------
download_and_extract() {
    local tag="$1"
    local url tmp
    url=$(asset_url_for_tag "$tag")
    tmp=$(mktemp -d)
    local pkg="$tmp/$ASSET"

    log_step "下载部署包"
    log_info "版本: ${tag:-latest}"
    if ! download_with_proxies "$url" "$pkg"; then
        log_error "部署包下载失败：请检查网络，或用 --proxy 指定可用代理，或用 -v 指定明确的版本 tag"
        rm -rf "$tmp"
        return 1
    fi
    log_success "下载完成: $(du -h "$pkg" | cut -f1)"

    # 强制校验 sha256（fail-closed）：校验文件必须可获取且与安装包一致，否则中止安装。
    # 此前校验文件与安装包来自同一镜像源、且不匹配只告警，等于没有完整性校验。
    local sha_url sha_file expect actual
    sha_url="${url}.sha256"
    sha_file="$tmp/${ASSET}.sha256"
    # 复用刚下载 tar 包成功的镜像源（仅用于取校验文件，最终仍要求与包内容一致）
    if ! download_with_proxies "$sha_url" "$sha_file" raw "$LAST_OK_PROXY"; then
        log_error "无法获取 SHA256 校验文件，已中止安装（安装包完整性无法验证）"
        rm -rf "$tmp"
        return 1
    fi
    if ! need_cmd sha256sum; then
        log_error "系统缺少 sha256sum，无法验证安装包完整性，已中止安装"
        rm -rf "$tmp"
        return 1
    fi
    expect=$(awk '{print $1}' "$sha_file" 2>/dev/null)
    actual=$(sha256sum "$pkg" | awk '{print $1}')
    if [[ -z "$expect" || "$expect" != "$actual" ]]; then
        log_error "SHA256 校验失败（期望 ${expect:-<空>}，实际 $actual），已中止安装"
        rm -rf "$tmp"
        return 1
    fi
    log_success "SHA256 校验通过"

    log_step "解压到 $INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    if ! tar -xzf "$pkg" -C "$INSTALL_DIR"; then
        log_error "解压失败，包可能损坏"
        rm -rf "$tmp"
        return 1
    fi
    chmod +x "$INSTALL_DIR"/*.sh 2>/dev/null || true
    rm -rf "$tmp"
    log_success "解压完成"
    return 0
}

# ---------------- 运行部署 ----------------
run_deploy() {
    if [[ "$DO_DEPLOY" != "true" ]]; then
        log_info "已跳过自动部署（--no-deploy）。稍后可手动执行:"
        echo "    cd \"$INSTALL_DIR\" && ./deploy.sh"
        return 0
    fi
    if [[ ! -f "$INSTALL_DIR/deploy.sh" ]]; then
        log_error "包内未找到 deploy.sh，无法自动部署"
        return 1
    fi
    log_step "运行部署脚本 deploy.sh"
    ( cd "$INSTALL_DIR" && chmod +x deploy.sh && ./deploy.sh )
}

# ---------------- 动作：安装 ----------------
do_install() {
    print_banner
    ensure_basic_tools
    local tag="$TARGET_TAG"
    # 未指定版本时解析出实际 tag，便于日志与后续比对；解析失败则退回 latest 通道
    if [[ -z "$tag" ]]; then
        if tag=$(fetch_latest_tag); then
            log_info "最新版本: ${BOLD}$tag${NC}"
        else
            log_warn "无法解析最新版本号，改用 latest 直连通道下载"
            tag=""
        fi
    fi
    download_and_extract "$tag" || exit 1
    run_deploy
    echo
    log_success "安装完成！安装目录: $INSTALL_DIR"
    log_info "查看版本: cat $INSTALL_DIR/VERSION"
    log_info "检查更新: bash install.sh check"
}

# ---------------- 动作：更新 ----------------
do_update() {
    print_banner
    ensure_basic_tools
    local local_tag remote_tag
    local_tag=$(get_local_tag)
    if [[ -z "$local_tag" ]]; then
        log_warn "本地未检测到已安装版本，将执行全新安装"
        do_install
        return
    fi

    if [[ -n "$TARGET_TAG" ]]; then
        remote_tag="$TARGET_TAG"
    else
        log_info "查询最新版本..."
        if ! remote_tag=$(fetch_latest_tag); then
            log_error "无法获取远端版本，更新中止"
            exit 1
        fi
    fi

    log_info "本地: $local_tag   远端: $remote_tag"
    if [[ "$local_tag" == "$remote_tag" ]]; then
        log_success "已是最新版本（$local_tag），无需更新"
        exit 0
    fi

    log_warn "开始更新: $local_tag -> $remote_tag"
    backup_config
    download_and_extract "$TARGET_TAG" || exit 1
    restore_config
    log_success "文件更新完成（配置已保留）"
    run_deploy
    echo
    log_success "更新完成！当前版本: $(get_local_tag)"
    [[ -n "$BACKUP_DIR" ]] && log_info "配置备份留存于: $BACKUP_DIR"
}

# ---------------- 主流程 ----------------
main() {
    parse_args "$@"
    case "$ACTION" in
        check)   do_check ;;
        update)  do_update ;;
        install) do_install ;;
        *)       log_error "未知动作: $ACTION"; exit 1 ;;
    esac
}

main "$@"
