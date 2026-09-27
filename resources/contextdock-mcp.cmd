@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0ContextDock.exe" "%~dp0resources\cli\mcp.cjs" %*
exit /b %errorlevel%
