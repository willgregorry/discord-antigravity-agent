param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("read", "write", "delete")]
    [string]$Action,

    [string]$Target = "gemini:antigravity"
)

$definition = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class WinCredManager {
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredWrite([In] ref CREDENTIAL userCredential, int flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredDelete(string target, int type, int flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree(IntPtr credential);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public static string Read(string target) {
        IntPtr ptr;
        if (CredRead(target, 1, 0, out ptr)) {
            try {
                CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
                if (cred.CredentialBlobSize > 0) {
                    byte[] bytes = new byte[cred.CredentialBlobSize];
                    Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
                    return Encoding.UTF8.GetString(bytes);
                }
            } finally {
                CredFree(ptr);
            }
        }
        return null;
    }

    public static bool Write(string target, string userName, string secret) {
        byte[] bytes = Encoding.UTF8.GetBytes(secret);
        IntPtr blobPtr = Marshal.AllocHGlobal(bytes.Length);
        try {
            Marshal.Copy(bytes, 0, blobPtr, bytes.Length);
            CREDENTIAL cred = new CREDENTIAL();
            cred.Flags = 0;
            cred.Type = 1; // Generic
            cred.TargetName = target;
            cred.Comment = "Managed by Antigravity Discord Agent";
            cred.CredentialBlobSize = bytes.Length;
            cred.CredentialBlob = blobPtr;
            cred.Persist = 2; // Local machine
            cred.AttributeCount = 0;
            cred.Attributes = IntPtr.Zero;
            cred.TargetAlias = null;
            cred.UserName = string.IsNullOrEmpty(userName) ? "antigravity" : userName;
            return CredWrite(ref cred, 0);
        } finally {
            Marshal.FreeHGlobal(blobPtr);
        }
    }

    public static bool Delete(string target) {
        return CredDelete(target, 1, 0);
    }
}
'@

try {
    Add-Type -TypeDefinition $definition -ErrorAction SilentlyContinue
} catch {}

if ($Action -eq "read") {
    $secret = [WinCredManager]::Read($Target)
    if ($secret) {
        [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
        Write-Output $secret
    }
} elseif ($Action -eq "write") {
    $inputData = [Console]::In.ReadToEnd()
    if ($inputData) {
        $userName = "antigravity"
        try {
            $json = $inputData | ConvertFrom-Json
            if ($json.id_token_email) { $userName = $json.id_token_email }
            elseif ($json.email) { $userName = $json.email }
        } catch {}
        $ok = [WinCredManager]::Write($Target, $userName, $inputData)
        if ($ok) { Write-Output "OK" } else { exit 1 }
    }
} elseif ($Action -eq "delete") {
    $ok = [WinCredManager]::Delete($Target)
    if ($ok) { Write-Output "OK" } else { exit 1 }
}
