using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public class Program {
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

    public static int Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;
        Console.InputEncoding = Encoding.UTF8;

        if (args.Length == 0) return 1;
        string action = args[0].ToLowerInvariant();
        string target = "gemini:antigravity";

        if (action == "read") {
            IntPtr ptr;
            if (CredRead(target, 1, 0, out ptr)) {
                try {
                    CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
                    if (cred.CredentialBlobSize > 0) {
                        byte[] bytes = new byte[cred.CredentialBlobSize];
                        Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
                        Console.Write(Encoding.UTF8.GetString(bytes));
                        return 0;
                    }
                } finally {
                    CredFree(ptr);
                }
            }
            return 2;
        } else if (action == "write") {
            string secret = null;
            if (args.Length >= 2 && File.Exists(args[1])) {
                secret = File.ReadAllText(args[1], Encoding.UTF8);
            } else {
                secret = Console.In.ReadToEnd();
            }
            if (string.IsNullOrWhiteSpace(secret)) return 3;

            byte[] bytes = Encoding.UTF8.GetBytes(secret.Trim());
            IntPtr blobPtr = Marshal.AllocHGlobal(bytes.Length);
            try {
                Marshal.Copy(bytes, 0, blobPtr, bytes.Length);
                CREDENTIAL cred = new CREDENTIAL();
                cred.Flags = 0;
                cred.Type = 1; // CRED_TYPE_GENERIC
                cred.TargetName = target;
                cred.Comment = "";
                cred.CredentialBlobSize = bytes.Length;
                cred.CredentialBlob = blobPtr;
                cred.Persist = 2; // CRED_PERSIST_LOCAL_MACHINE
                cred.AttributeCount = 0;
                cred.Attributes = IntPtr.Zero;
                cred.TargetAlias = null;
                cred.UserName = "antigravity";
                if (CredWrite(ref cred, 0)) {
                    Console.Write("OK");
                    return 0;
                }
                return 4;
            } finally {
                Marshal.FreeHGlobal(blobPtr);
            }
        } else if (action == "delete") {
            return CredDelete(target, 1, 0) ? 0 : 5;
        }
        return 1;
    }
}
