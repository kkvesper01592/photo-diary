@echo off
chcp 65001 >nul
title 写真日記 (この画面を閉じるとアプリも止まります)
cd /d "%~dp0"
echo 写真日記を起動しています...
echo ブラウザが自動で開きます。使い終わったら、この黒い画面を閉じてください。
echo.
call npm run dev -- --open /photo-diary/
echo.
echo 起動できませんでした。すでに別の画面で起動している場合は、そちらをお使いください。
pause
