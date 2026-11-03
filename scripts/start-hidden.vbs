Set FSO = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
rootDir = FSO.GetParentFolderName(scriptDir)
WshShell.CurrentDirectory = rootDir
WshShell.Run "cmd.exe /c node index.js", 0, False
