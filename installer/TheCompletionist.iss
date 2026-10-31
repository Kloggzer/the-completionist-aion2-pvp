; Installer for The Completionist (Inno Setup 6).
; Build: ISCC installer\TheCompletionist.iss /DAppVersion=1.1.0 /DSourceExe=<path to the published TheCompletionist.exe>
;   SourceExe = the framework-dependent build (dotnet publish --self-contained false), ~5 MB.
; Per-user install. Asks for the tracking mode and installs/checks the prerequisites:
;   - .NET 8 Desktop Runtime: downloaded from Microsoft and installed if missing (Windows asks for admin rights once)
;   - WebView2 Runtime (UI; preinstalled on Windows 11): downloaded and installed if missing
;   - Npcap (only for the automatic mode; its licence does not allow bundling, so the download page is opened)
; The chosen mode is written to {app}\setup.json; the app reads it on its first start.

#ifndef AppVersion
  #define AppVersion "1.1.0"
#endif
#ifndef SourceExe
  #define SourceExe "..\publish\TheCompletionist.exe"
#endif

[Setup]
AppId={{6E8F3A52-7B1D-4C9E-9A41-2C5D7E0B9F13}
AppName=The Completionist
AppVersion={#AppVersion}
AppPublisher=Kloggzer
AppPublisherURL=https://github.com/Kloggzer/the-completionist-aion2
AppSupportURL=https://github.com/Kloggzer/the-completionist-aion2/issues
DefaultDirName={localappdata}\Programs\TheCompletionist
DefaultGroupName=The Completionist
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=Output
OutputBaseFilename=TheCompletionist-Setup-{#AppVersion}
SetupIconFile=..\app.ico
UninstallDisplayIcon={app}\TheCompletionist.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
de.ModeTitle=Tracking-Modus
de.ModeDesc=Wie soll The Completionist deinen Fortschritt erfassen?
de.ModeSub=Das kannst du später jederzeit in den Einstellungen ändern.
de.ModeAuto=Automatisch – liest den Netzwerkverkehr des Spiels passiv mit (benötigt Npcap)
de.ModeManual=Manuell – ohne Npcap, du trägst Seelen, Erfolge und Charaktere selbst ein
de.NpcapMissing=Npcap ist nicht installiert. Für den automatischen Modus wird es benötigt.%n%nSoll die Npcap-Downloadseite jetzt geöffnet werden? (Bei der Installation die Standardoptionen übernehmen.)%n%nOhne Npcap startet die App im manuellen Modus.
de.Prereq=Benötigte Komponenten von Microsoft werden geladen …
de.PrereqFailed=%1 konnte nicht installiert werden. Bitte später selbst installieren:%n%2
de.DesktopIcon=Desktop-Verknüpfung erstellen
en.ModeTitle=Tracking mode
en.ModeDesc=How should The Completionist track your progress?
en.ModeSub=You can change this at any time in the settings.
en.ModeAuto=Automatic – passively reads the game's network traffic (requires Npcap)
en.ModeManual=Manual – no Npcap, you enter souls, achievements and characters yourself
en.NpcapMissing=Npcap is not installed. The automatic mode needs it.%n%nOpen the Npcap download page now? (Keep the default options when installing.)%n%nWithout Npcap the app starts in manual mode.
en.Prereq=Downloading required components from Microsoft …
en.PrereqFailed=%1 could not be installed. Please install it yourself later:%n%2
en.DesktopIcon=Create a desktop shortcut

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; Flags: unchecked

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\The Completionist"; Filename: "{app}\TheCompletionist.exe"
Name: "{autodesktop}\The Completionist"; Filename: "{app}\TheCompletionist.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\TheCompletionist.exe"; Description: "{cm:LaunchProgram,The Completionist}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\setup.json"

[Code]
var
  ModePage: TInputOptionWizardPage;
  DownloadPage: TDownloadWizardPage;

function DotNetInstalled: Boolean;
var
  Names: TFindRec;
begin
  // Any 8.x Microsoft.WindowsDesktop.App (the app targets net8.0-windows and rolls forward within 8.x).
  Result := FindFirst(ExpandConstant('{commonpf64}\dotnet\shared\Microsoft.WindowsDesktop.App\8.*'), Names);
  if Result then FindClose(Names);
end;

function NpcapInstalled: Boolean;
begin
  Result := FileExists(ExpandConstant('{sys}\Npcap\wpcap.dll')) or FileExists(ExpandConstant('{sys}\wpcap.dll'))
    or RegKeyExists(HKLM, 'SOFTWARE\Npcap') or RegKeyExists(HKLM, 'SOFTWARE\WOW6432Node\Npcap');
end;

function WebView2Installed: Boolean;
var
  V: String;
begin
  // Evergreen runtime, per machine or per user (see Microsoft's WebView2 distribution docs).
  Result := (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) and (V <> '') and (V <> '0.0.0.0'))
    or (RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) and (V <> '') and (V <> '0.0.0.0'))
    or (RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

procedure OpenUrl(const Url: String);
var
  Code: Integer;
begin
  ShellExec('open', Url, '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;

procedure InitializeWizard;
begin
  ModePage := CreateInputOptionPage(wpSelectTasks, CustomMessage('ModeTitle'), CustomMessage('ModeDesc'), CustomMessage('ModeSub'), True, False);
  ModePage.Add(CustomMessage('ModeAuto'));
  ModePage.Add(CustomMessage('ModeManual'));
  if NpcapInstalled then ModePage.SelectedValueIndex := 0 else ModePage.SelectedValueIndex := 1;
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), CustomMessage('Prereq'), nil);
end;

// Run a downloaded Microsoft installer; ShellExec so that its own UAC prompt can appear (this setup runs without admin).
function RunInstaller(const Name, File, Params, Url: String): Boolean;
var
  Code: Integer;
begin
  Result := ShellExec('', ExpandConstant('{tmp}\') + File, Params, '', SW_SHOW, ewWaitUntilTerminated, Code) and ((Code = 0) or (Code = 3010));
  if not Result then MsgBox(FmtMessage(CustomMessage('PrereqFailed'), [Name, Url]), mbError, MB_OK);
end;

// Before installing: fetch and install what is missing (.NET 8 Desktop Runtime, WebView2).
function NextButtonClick(CurPageID: Integer): Boolean;
var
  NeedNet, NeedWv: Boolean;
begin
  Result := True;
  if CurPageID <> wpReady then exit;
  NeedNet := not DotNetInstalled;
  NeedWv := not WebView2Installed;
  if not (NeedNet or NeedWv) then exit;
  DownloadPage.Clear;
  if NeedNet then DownloadPage.Add('https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe', 'windowsdesktop-runtime.exe', '');
  if NeedWv then DownloadPage.Add('https://go.microsoft.com/fwlink/p/?LinkId=2124703', 'MicrosoftEdgeWebview2Setup.exe', '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      if NeedNet then RunInstaller('.NET 8 Desktop Runtime', 'windowsdesktop-runtime.exe', '/install /quiet /norestart', 'https://dotnet.microsoft.com/download/dotnet/8.0');
      if NeedWv then RunInstaller('WebView2 Runtime', 'MicrosoftEdgeWebview2Setup.exe', '/silent /install', 'https://developer.microsoft.com/microsoft-edge/webview2/');
    except
      if DownloadPage.AbortedByUser then Result := False
      else MsgBox(GetExceptionMessage, mbError, MB_OK);
    end;
  finally
    DownloadPage.Hide;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Mode: String;
begin
  if CurStep = ssPostInstall then
  begin
    if ModePage.SelectedValueIndex = 0 then Mode := 'auto' else Mode := 'manual';
    SaveStringToFile(ExpandConstant('{app}\setup.json'), '{ "mode": "' + Mode + '" }', False);
    if not WizardSilent then
    begin
      if (Mode = 'auto') and not NpcapInstalled then
        if MsgBox(CustomMessage('NpcapMissing'), mbConfirmation, MB_YESNO) = IDYES then
          OpenUrl('https://npcap.com/#download');
    end;
  end;
end;
