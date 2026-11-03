Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "D:\UB\Discord\Antigravity-Agent"
WshShell.Run "cmd.exe /c node index.js", 0, False
