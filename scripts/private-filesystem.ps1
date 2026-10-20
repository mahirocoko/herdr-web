# Fixed fork-owned worker. Paths arrive only as JSON on stdin, never as code.
# Windows PowerShell 5.1 / .NET Framework only; no policy or elevation changes.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Attributes-OrAbsent([string] $Path) {
    try { return [IO.File]::GetAttributes($Path) }
    catch [IO.FileNotFoundException] { return $null }
    catch [IO.DirectoryNotFoundException] { return $null }
    # Access denied and all other inspection errors must propagate.
}

function Descriptor-Principals([string] $Path, [bool] $Private, [bool] $Directory) {
    # Windows servicing authority at a volume ancestor, NEVER a private grant.
    if (!$Private -and $Directory -and $Path -match '^[A-Za-z]:\\$' -and [String]::Equals([IO.Path]::GetFullPath($Path), [IO.Path]::GetPathRoot($Path), [StringComparison]::OrdinalIgnoreCase)) {
        return $trusted + @('S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464')
    }
    return $trusted
}

function Assert-Descriptor([string] $Path, [bool] $Private, [bool] $Directory) {
    $attributes = Attributes-OrAbsent $Path
    if ($null -eq $attributes) { throw 'Protected path disappeared' }
    if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse points are not private filesystem paths' }
    if ((($attributes -band [IO.FileAttributes]::Directory) -ne 0) -ne $Directory) { throw 'Unexpected protected path type' }
    if ($Directory) { $security = [IO.Directory]::GetAccessControl($Path) }
    else { $security = [IO.File]::GetAccessControl($Path) }
    $raw = [Security.AccessControl.RawSecurityDescriptor]::new($security.GetSecurityDescriptorBinaryForm(), 0)
    $principals = @(Descriptor-Principals $Path $Private $Directory)
    if ($null -eq $raw.Owner -or $principals -notcontains $raw.Owner.Value) { throw ('Unrecognized protected path owner ' + $raw.Owner + ' at ' + $Path + '; no ACL repair attempted') }
    if (($raw.ControlFlags -band [Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -eq 0 -or $null -eq $raw.DiscretionaryAcl) { throw 'Null or missing DACL refused' }
    foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace -isnot [Security.AccessControl.CommonAce] -or $ace.IsCallback -or $ace.AceType -ne [Security.AccessControl.AceType]::AccessAllowed -or (([int]$ace.AceFlags -band (-bnot 31)) -ne 0)) { throw 'Deny or unsupported ACE refused' }
        if ($principals -contains $ace.SecurityIdentifier.Value) { continue }
        if ($Private) { throw 'Untrusted Allow ACE on private path' }
        # Ancestors may be readable/traversable. Reject effective replacement,
        # deletion and security-descriptor authority, not harmless read access.
        if (($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly) -ne 0) { continue }
        $replacement = 0x00010000 -bor 0x00040000 -bor 0x00080000 -bor 0x00000040 -bor 0x10000000
        if (($ace.AccessMask -band $replacement) -ne 0) { throw 'Untrusted ancestor replacement or ACL authority' }
    }
    return $security
}

function Assert-Chain([string] $Path) {
    $cursor = [IO.Path]::GetDirectoryName($Path)
    $chain = [Collections.Generic.List[string]]::new()
    while ($cursor) {
        $chain.Add($cursor)
        $next = [IO.Path]::GetDirectoryName($cursor)
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
    for ($i = $chain.Count - 1; $i -ge 0; $i--) {
        $ancestor = $chain[$i]
        if ($null -ne (Attributes-OrAbsent $ancestor)) { $null = Assert-Descriptor $ancestor $false $true }
    }
}

function New-PrivateSecurity {
    $security = [Security.AccessControl.DirectorySecurity]::new()
    $security.SetOwner([Security.Principal.SecurityIdentifier]::new($trusted[0]))
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in $trusted) {
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new($sid),
            [Security.AccessControl.FileSystemRights]::FullControl,
            ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow)
        $security.AddAccessRule($rule)
    }
    return $security
}

function Ensure-PrivateDirectory([string] $Path) {
    if ($null -ne (Attributes-OrAbsent $Path)) { return }
    $parent = [IO.Path]::GetDirectoryName($Path)
    if (!$parent -or $parent -eq $Path) { throw 'Cannot create private volume root' }
    Ensure-PrivateDirectory $parent
    # Framework overload supplies the descriptor to native creation, rather
    # than opening a public directory and repairing it after creation.
    $null = [IO.Directory]::CreateDirectory($Path, (New-PrivateSecurity))
    $null = Assert-Descriptor $Path $true $true
}

function Assert-Tree([string] $Root) {
    $pending = [Collections.Generic.Stack[object]]::new()
    $pending.Push(@($Root, 0))
    $count = 0
    $scheduled = 1
    while ($pending.Count -gt 0) {
        $item = $pending.Pop()
        $path = [string] $item[0]
        $depth = [int] $item[1]
        $count++
        if ($count -gt 4096 -or $depth -gt 32) { throw 'Private runtime inspection limit exceeded; no migration attempted' }
        $attributes = Attributes-OrAbsent $path
        if ($null -eq $attributes) { throw 'Runtime entry disappeared during inspection' }
        $directory = ($attributes -band [IO.FileAttributes]::Directory) -ne 0
        $security = Assert-Descriptor $path $true $directory
        if ($directory) {
            Assert-DirectoryInheritance $security
            foreach ($child in [IO.Directory]::EnumerateFileSystemEntries($path)) {
                $scheduled++
                if ($scheduled -gt 4096) { throw 'Private runtime inspection limit exceeded; no migration attempted' }
                $pending.Push(@($child, ($depth + 1)))
            }
        }
    }
}

function Assert-DirectoryInheritance($Security) {
    $both = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    $full = [int][Security.AccessControl.FileSystemRights]::FullControl
    foreach ($rule in $Security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
        if ($rule.IdentityReference.Value -eq $trusted[0] -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and ($rule.InheritanceFlags -band $both) -eq $both -and $rule.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::None -and (([int]$rule.FileSystemRights -band $full) -eq $full)) { return }
    }
    throw 'Runtime directory lacks inheritable current-user private control; no ACL repair attempted'
}

function Assert-Inheritance([string] $Root) {
    $witness = [IO.Path]::Combine($Root, ('.privacy-witness-' + [Guid]::NewGuid().ToString('N')))
    $file = [IO.Path]::Combine($witness, 'child')
    $renamed = [IO.Path]::Combine($witness, 'renamed')
    try {
        $null = [IO.Directory]::CreateDirectory($witness)
        $null = Assert-Descriptor $witness $true $true
        $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $stream.Dispose()
        $null = Assert-Descriptor $file $true $false
        [IO.File]::Move($file, $renamed)
        $null = Assert-Descriptor $renamed $true $false
        $subdir = [IO.Path]::Combine($witness, 'subdir')
        $null = [IO.Directory]::CreateDirectory($subdir)
        $null = Assert-Descriptor $subdir $true $true
        $moved = [IO.Path]::Combine($subdir, 'pasted')
        [IO.File]::Move($renamed, $moved)
        $null = Assert-Descriptor $moved $true $false
    }
    finally {
        # Only this unpredictable, newly-owned disposable subtree is removed.
        if ([IO.Directory]::Exists($witness)) { [IO.Directory]::Delete($witness, $true) }
    }
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ((($request.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'operation,path,version') { throw 'Malformed privacy request' }
    if ($request.version -ne 1 -or $request.operation -notin @('read', 'prepare') -or $request.path -isnot [string]) { throw 'Malformed privacy request' }
    $path = $request.path
    if ($path.Length -gt 240 -or $path -notmatch '^[A-Za-z]:\\' -or $path.Substring(3) -match '[:\x00-\x1f<>"|?*]') { throw 'Unsupported private filesystem path syntax or length' }
    # Framework normalizes valid DOS short-name aliases (for example RUNNER~1).
    # Inspect the canonical native path, not whether the caller spelled that alias.
    $path = [IO.Path]::GetFullPath($path)
    if ($path.Length -gt 240 -or $path -notmatch '^[A-Za-z]:\\' -or $path.Substring(3) -match '[:\x00-\x1f<>"|?*]') { throw 'Unsupported canonical private filesystem path' }
    foreach ($part in $path.Substring(3).Split('\')) {
        if (!$part -or $part -match '[. ]$' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsupported private path component' }
    }
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($path))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed -or $drive.DriveFormat -ne 'NTFS') { throw 'Private runtime requires a local fixed NTFS volume' }
    $trusted = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
    Assert-Chain $path
    if ($request.operation -eq 'read') {
        if ($null -eq (Attributes-OrAbsent $path)) {
            @{ version = 1; operation = 'read'; status = 'absent' } | ConvertTo-Json -Compress
        }
        else {
            $null = Assert-Descriptor ([IO.Path]::GetDirectoryName($path)) $true $true
            $null = Assert-Descriptor $path $true $false
            # Bound both metadata and the actual read, even if the file grows.
            $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
            try {
                if ($stream.Length -gt 16384) { throw 'Existing private configuration is oversized; left unchanged' }
                $buffer = [byte[]]::new(16385)
                $count = 0
                while ($count -lt $buffer.Length) {
                    $read = $stream.Read($buffer, $count, ($buffer.Length - $count))
                    if ($read -eq 0) { break }
                    $count += $read
                }
                if ($count -gt 16384) { throw 'Existing private configuration is oversized; left unchanged' }
                $bytes = [Convert]::ToBase64String($buffer, 0, $count)
            }
            finally { $stream.Dispose() }
            @{ version = 1; operation = 'read'; status = 'read'; bytes = $bytes } | ConvertTo-Json -Compress
        }
    }
    else {
        # Inspect existing content BEFORE creating witnesses; never repair ACLs.
        if ($null -ne (Attributes-OrAbsent $path)) { Assert-Tree $path }
        Ensure-PrivateDirectory $path
        $security = Assert-Descriptor $path $true $true
        if (!$security.AreAccessRulesProtected) { throw 'Runtime root must have a protected DACL; no repair attempted' }
        Assert-DirectoryInheritance $security
        Assert-Inheritance $path
        @{ version = 1; operation = 'prepare'; status = 'ready' } | ConvertTo-Json -Compress
    }
}
catch {
    [Console]::Error.WriteLine('Private filesystem refused: ' + $_.Exception.Message)
    [Console]::Error.WriteLine($_.ScriptStackTrace)
    exit 1
}
