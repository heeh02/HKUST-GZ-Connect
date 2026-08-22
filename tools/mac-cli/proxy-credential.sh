#!/usr/bin/env bash
# Owner-only stable credential contract for the macOS CLI's local proxy.
# This file is sourced by the root compatibility wrapper and is independently
# exercised by the desktop Node test suite. It never prints credential values.

cli_proxy_file_mode() {
  stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null
}

cli_proxy_file_links() {
  stat -f '%l' "$1" 2>/dev/null || stat -c '%h' "$1" 2>/dev/null
}

cli_proxy_valid_endpoint() {
  case "$1" in
    127.0.0.1:*) ;;
    *) return 1 ;;
  esac
  local port="${1##*:}"
  case "$port" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$port" -ge 1025 ] 2>/dev/null && [ "$port" -le 65535 ] 2>/dev/null
}

cli_proxy_valid_secret() {
  local value="$1"
  [ "${#value}" -ge 16 ] && [ "${#value}" -le 128 ] || return 1
  case "$value" in
    *[!A-Za-z0-9_-]*) return 1 ;;
  esac
}

cli_proxy_clear() {
  CLI_PROXY_ENDPOINT=''
  CLI_PROXY_USERNAME=''
  CLI_PROXY_PASSWORD=''
  unset CLI_PROXY_ENDPOINT CLI_PROXY_USERNAME CLI_PROXY_PASSWORD
}

cli_proxy_read_file() {
  local file="$1"
  cli_proxy_clear
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  [ "$(cli_proxy_file_mode "$file")" = '600' ] || return 1
  [ "$(cli_proxy_file_links "$file")" = '1' ] || return 1
  local size
  size="$(wc -c < "$file" 2>/dev/null | tr -d '[:space:]')" || return 1
  case "$size" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$size" -ge 1 ] && [ "$size" -le 1024 ] || return 1
  [ "$(awk 'END { print NR }' "$file" 2>/dev/null)" = '3' ] || return 1

  CLI_PROXY_ENDPOINT="$(sed -n '1p' "$file")" || return 1
  CLI_PROXY_USERNAME="$(sed -n '2p' "$file")" || return 1
  CLI_PROXY_PASSWORD="$(sed -n '3p' "$file")" || return 1
  if ! cli_proxy_valid_endpoint "$CLI_PROXY_ENDPOINT" ||
      ! cli_proxy_valid_secret "$CLI_PROXY_USERNAME" ||
      ! cli_proxy_valid_secret "$CLI_PROXY_PASSWORD" ||
      [ "$CLI_PROXY_USERNAME" = "$CLI_PROXY_PASSWORD" ]; then
    cli_proxy_clear
    return 1
  fi
}

cli_proxy_write_file() {
  local file="$1" endpoint="$2" username="$3" password="$4"
  local directory="${file%/*}"
  [ "$directory" != "$file" ] || return 1
  [ ! -L "$directory" ] || return 1
  mkdir -p "$directory" || return 1
  [ -d "$directory" ] && [ ! -L "$directory" ] || return 1
  chmod 700 "$directory" || return 1

  local temporary
  temporary="$(mktemp "$directory/.proxy-credential.XXXXXX")" || return 1
  chmod 600 "$temporary" || { rm -f "$temporary"; return 1; }
  if ! (umask 077; printf '%s\n%s\n%s\n' "$endpoint" "$username" "$password" > "$temporary"); then
    rm -f "$temporary"
    return 1
  fi
  mv -f "$temporary" "$file" || { rm -f "$temporary"; return 1; }
  chmod 600 "$file" || return 1
}

cli_proxy_random_secret() {
  command -v openssl >/dev/null 2>&1 || return 1
  openssl rand -base64 24 2>/dev/null | tr '/+' '_-' | tr -d '=\r\n'
}

cli_proxy_load_or_create() {
  local file="$1" expected_endpoint="$2"
  cli_proxy_valid_endpoint "$expected_endpoint" || return 1
  if [ -e "$file" ] || [ -L "$file" ]; then
    cli_proxy_read_file "$file" || return 1
    if [ "$CLI_PROXY_ENDPOINT" != "$expected_endpoint" ]; then
      cli_proxy_write_file \
        "$file" "$expected_endpoint" "$CLI_PROXY_USERNAME" "$CLI_PROXY_PASSWORD" || {
          cli_proxy_clear
          return 1
        }
      cli_proxy_read_file "$file" || return 1
    fi
    return 0
  fi

  local username password attempt=0
  username="$(cli_proxy_random_secret)" || return 1
  cli_proxy_valid_secret "$username" || return 1
  password=''
  while [ "$attempt" -lt 3 ]; do
    password="$(cli_proxy_random_secret)" || return 1
    if cli_proxy_valid_secret "$password" && [ "$password" != "$username" ]; then
      break
    fi
    password=''
    attempt=$((attempt + 1))
  done
  [ -n "$password" ] || return 1
  cli_proxy_write_file "$file" "$expected_endpoint" "$username" "$password" || return 1
  username=''
  password=''
  cli_proxy_read_file "$file"
}
