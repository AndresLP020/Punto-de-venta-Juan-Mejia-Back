param(
  [Parameter(Mandatory = $true)][string]$Printer,
  [Parameter(Mandatory = $true)][string]$Base64
)

$bytes = [Convert]::FromBase64String($Base64)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint="ClosePrinter", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint="EndDocPrinter", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="StartPagePrinter", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="EndPagePrinter", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint="WritePrinter", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
}
"@

$h = [IntPtr]::Zero
if (-not [PosRawPrinter]::OpenPrinter($Printer, [ref]$h, [IntPtr]::Zero)) {
  throw "No se pudo abrir la impresora $Printer"
}
try {
  $di = New-Object PosRawPrinter+DOCINFOA
  $di.pDocName = "Ticket POS"
  $di.pDataType = "RAW"
  if (-not [PosRawPrinter]::StartDocPrinter($h, 1, $di)) { throw "StartDocPrinter fallo" }
  try {
    [void][PosRawPrinter]::StartPagePrinter($h)
    $p = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
      [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $p, $bytes.Length)
      $written = 0
      if (-not [PosRawPrinter]::WritePrinter($h, $p, $bytes.Length, [ref]$written)) { throw "WritePrinter fallo" }
      Write-Output "OK $written"
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($p)
    }
    [void][PosRawPrinter]::EndPagePrinter($h)
  } finally {
    [void][PosRawPrinter]::EndDocPrinter($h)
  }
} finally {
  [void][PosRawPrinter]::ClosePrinter($h)
}
