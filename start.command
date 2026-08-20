#!/bin/bash
# 知识图书馆启动器：双击即可打开网页
cd "$(dirname "$0")"
exec python3 lib.py open
