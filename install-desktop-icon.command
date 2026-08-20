#!/bin/bash
# 一键在桌面创建「Skill图书馆」快捷图标（macOS）
set -e

cd "$(dirname "$0")"
LIB_DIR="$(pwd)"
APP_PATH="$HOME/Desktop/Skill图书馆.app"
TMP_DIR="$(mktemp -d -t skill-lib)"
TMP_SCRIPT="$TMP_DIR/launch.applescript"
TMP_APP="$TMP_DIR/Skill图书馆.app"

# 生成 AppleScript，路径已动态注入当前项目位置
cat > "$TMP_SCRIPT" <<EOF
do shell script "curl -s -m 2 -o /dev/null http://127.0.0.1:8765/api/health && open http://127.0.0.1:8765/ || (cd '$LIB_DIR' && nohup python3 lib.py open >/dev/null 2>&1 &)"
EOF

echo "正在生成桌面图标..."
osacompile -o "$TMP_APP" "$TMP_SCRIPT"

# 替换旧图标（旧图标会备份为 Skill图书馆.app.old）
if [ -e "$APP_PATH" ]; then
  mv "$APP_PATH" "$APP_PATH.old"
fi
mv "$TMP_APP" "$APP_PATH"
rm -f "$TMP_SCRIPT"
rmdir "$TMP_DIR" 2>/dev/null || true

echo ""
echo "✅ 完成！桌面已出现「Skill图书馆」图标。"
echo "双击即可打开；重复双击不会开多个窗口。"
if [ -e "$APP_PATH.old" ]; then
  echo "（旧的图标已备份为 Skill图书馆.app.old，确认没问题后可以手动删除）"
fi
