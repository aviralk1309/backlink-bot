param(
    [string[]]$Exclude = @(
        ".git",
        ".next",
        "node_modules",
        ".pnpm",
        ".venv",
        "venv",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "dist",
        "build",
        "coverage",
        "playwright-report",
        "test-results"
    ),

    [string]$Output = ""
)

$Root = (Get-Location).Path

function Show-Tree {
    param(
        [string]$Path,
        [string]$Prefix = ""
    )

    $items = Get-ChildItem -LiteralPath $Path -Force |
        Where-Object {
            $Exclude -notcontains $_.Name
        } |
        Sort-Object @{
            Expression = { $_.PSIsContainer }
            Descending = $true
        }, Name

    for ($i = 0; $i -lt $items.Count; $i++) {

        $item = $items[$i]

        if ($i -eq $items.Count - 1) {
            $Branch = "└── "
            $NextPrefix = "$Prefix    "
        }
        else {
            $Branch = "├── "
            $NextPrefix = "$Prefix│   "
        }

        if ($item.PSIsContainer) {
            Write-Output "$Prefix$Branch$($item.Name)/"

            Show-Tree `
                -Path $item.FullName `
                -Prefix $NextPrefix
        }
        else {
            Write-Output "$Prefix$Branch$($item.Name)"
        }
    }
}

$Tree = @(
    "$((Split-Path $Root -Leaf))/"
    Show-Tree -Path $Root
)

if ([string]::IsNullOrWhiteSpace($Output)) {
    $Tree
}
else {
    $Tree | Set-Content -Path $Output -Encoding utf8
    Write-Host "Project tree written to $Output"
}


# .\project-tree.ps1