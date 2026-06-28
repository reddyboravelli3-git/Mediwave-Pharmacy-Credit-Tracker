# Zero-Dependency Full-Stack PowerShell Backend
# Serves static assets and provides REST APIs for Pharmacy Dues Tracker
$port = 8000
$root = "c:\Users\BORAVELLI REDDY\.antigravity-ide"
$dbFile = Join-Path $root "db.json"
$mockToday = Get-Date "2026-06-24"

# Set up http listener
$listener = New-Object System.Net.HttpListener

# Try to add wildcard prefixes for LAN access
try {
    $listener.Prefixes.Add("http://*:$port/")
    $listener.Start()
    Write-Host "Full-Stack PowerShell Server started on http://*:$port/ (LAN Access Enabled)"
    
    # Configure Windows Firewall rule since we have administrator privileges
    New-NetFirewallRule -DisplayName "Mediwave Pharmacy Server" -Direction Inbound -LocalPort $port -Protocol TCP -Action Allow -ErrorAction SilentlyContinue | Out-Null
} catch {
    # If wildcard fails (e.g. Access Denied), try specific IP addresses or fallback to localhost
    Write-Warning "Could not bind to wildcard prefix (requires admin privileges). Attempting local IP bindings..."
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$port/")
        $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) | Where-Object { $_.AddressFamily -eq 'InterNetwork' }
        foreach ($ip in $ips) {
            $listener.Prefixes.Add("http://$($ip.IPAddressToString):$port/")
        }
        $listener.Start()
        Write-Host "Full-Stack PowerShell Server started on http://localhost:$port/ and LAN IPs: $($ips.IPAddressToString)"
    } catch {
        # Final fallback to standard localhost
        Write-Warning "LAN binding failed. Falling back to localhost only."
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add("http://localhost:$port/")
        $listener.Start()
        Write-Host "Full-Stack PowerShell Server started on http://localhost:$port/ (Local access only)"
    }
}

# Helper: Read Database and ensure schema seeding
function Read-Database {
    $db = $null
    if (Test-Path $dbFile) {
        $content = Get-Content $dbFile -Raw -Encoding UTF8
        try {
            $db = ConvertFrom-Json $content
        } catch {
            # corrupt json
        }
    }
    
    # Check if DB is empty or missing key relational tables, if so re-seed
    if ($null -eq $db -or $null -eq $db.users -or $null -eq $db.vendors -or $null -eq $db.credits -or $null -eq $db.payments -or $null -eq $db.config) {
        $seed = @{
            config = @{
                escalationDays = 30
                creditLimit = 150000
                archiveDays = 15
            }
            users = @(
                @{ id = 1; email = "admin@gmail.com"; password_plain = "AdminPassword123"; name = "Sahitya Reddy"; role = "admin" }
                @{ id = 2; email = "user@gmail.com"; password_plain = "UserPassword123"; name = "Vikram Reddy"; role = "user" }
                @{ id = 3; email = "salesrep2@mediwave.com"; password_plain = "RepSecure2026!"; name = "Ramesh Kumar"; role = "user" }
            )
            vendors = @(
                @{ id = 1; name = "Apollo Pharmacy, Jubilee Hills"; city = "Hyderabad"; state = "Telangana" }
                @{ id = 2; name = "MedPlus Pharmacy, Gachibowli"; city = "Hyderabad"; state = "Telangana" }
                @{ id = 3; name = "Yashoda Pharmacy, Somajiguda"; city = "Hyderabad"; state = "Telangana" }
                @{ id = 4; name = "Care Pharmacy, Secunderabad"; city = "Secunderabad"; state = "Telangana" }
                @{ id = 5; name = "Royal Pharmacy, Hanamkonda"; city = "Warangal"; state = "Telangana" }
                @{ id = 6; name = "TruMed Pharmacy, Nizamabad"; city = "Nizamabad"; state = "Telangana" }
            )
            credits = @(
                @{ id = 1; vendor_id = 1; invoice_number = "INV-2026-1001"; invoice_date = "2026-05-10"; due_date = "2026-05-24"; amount_due = 45000.00; assigned_to_user_id = 2; status = "Active"; createdAt = "2026-05-10T10:00:00Z" }
                @{ id = 2; vendor_id = 2; invoice_number = "INV-2026-1002"; invoice_date = "2026-06-01"; due_date = "2026-06-15"; amount_due = 28000.00; assigned_to_user_id = 2; status = "Completed"; createdAt = "2026-06-01T09:15:00Z" }
                @{ id = 3; vendor_id = 3; invoice_number = "INV-2026-1003"; invoice_date = "2026-06-05"; due_date = "2026-06-20"; amount_due = 62000.00; assigned_to_user_id = 2; status = "Active"; createdAt = "2026-06-05T11:45:00Z" }
                @{ id = 4; vendor_id = 4; invoice_number = "INV-2026-1004"; invoice_date = "2026-04-20"; due_date = "2026-05-10"; amount_due = 85000.00; assigned_to_user_id = 3; status = "Active"; createdAt = "2026-04-20T14:00:00Z" }
                @{ id = 5; vendor_id = 5; invoice_number = "INV-2026-1005"; invoice_date = "2026-06-15"; due_date = "2026-07-15"; amount_due = 35000.00; assigned_to_user_id = 3; status = "Active"; createdAt = "2026-06-15T15:30:00Z" }
            )
            payments = @(
                @{ id = 1; credit_due_id = 1; payment_date = "2026-05-20"; amount_paid = 15000.00; payment_method = "UPI" }
                @{ id = 2; credit_due_id = 2; payment_date = "2026-06-14"; amount_paid = 28000.00; payment_method = "Bank Transfer" }
                @{ id = 3; credit_due_id = 3; payment_date = "2026-06-18"; amount_paid = 10000.00; payment_method = "Cheque" }
                @{ id = 4; credit_due_id = 4; payment_date = "2026-05-05"; amount_paid = 25000.00; payment_method = "UPI" }
            )
            auditLogs = @(
                @{ time = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"); message = "System database initialized and seeded with mock entries." }
            )
        }
        Write-Database $seed
        $db = ConvertFrom-Json (ConvertTo-Json $seed -Depth 10)
    }
    return $db
}

function Write-Database ($db) {
    $json = ConvertTo-Json $db -Depth 10
    Set-Content $dbFile $json -Encoding UTF8
}

function Add-AuditLog ($db, $msg) {
    $log = @{
        time = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
        message = $msg
    }
    $db.auditLogs = @($log) + @($db.auditLogs)
}

# Unified JSON response helper
function Write-JsonResponse ($response, $statusCode, $object) {
    $response.StatusCode = $statusCode
    $response.ContentType = "application/json; charset=utf-8"
    $jsonString = ConvertTo-Json $object -Depth 10
    $resBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonString)
    $response.ContentLength64 = $resBytes.Length
    $response.OutputStream.Write($resBytes, 0, $resBytes.Length)
}

# Simulated token parser
function Get-AuthenticatedUser ($request, $db) {
    $authHeader = $request.Headers["Authorization"]
    if ($authHeader -and $authHeader -match "(?i)^Bearer\s+(.+)$") {
        $tokenVal = $Matches[1]
        if ($tokenVal -match "mock-jwt-token-for-user-id-(\d+)-role-(\w+)") {
            $userId = [int]$Matches[1]
            $user = $db.users | Where-Object { $_.id -eq $userId }
            return $user
        }
    }
    return $null
}

# Request Listening Loop
while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath
        $method = $request.HttpMethod
        $query = $request.QueryString

        # Enable CORS
        $response.Headers.Add("Access-Control-Allow-Origin", "*")
        $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")

        if ($method -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.OutputStream.Close()
            continue
        }

        # Read active DB
        $db = Read-Database

        # --- ROUTE DISPATCHER WITH Robust TRY-CATCH ---
        try {
            # Check if it is a static file request (does not start with /api)
            if ($path -notlike "/api/*") {
                $cleanPath = $path.Replace("..", "").TrimStart('/')
                if ($cleanPath -eq "") { $cleanPath = "index.html" }
                $filePath = Join-Path $root $cleanPath

                if (Test-Path $filePath -PathType Leaf) {
                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    
                    # MIME Types
                    if ($filePath.EndsWith(".html")) { $response.ContentType = "text/html; charset=utf-8" }
                    elseif ($filePath.EndsWith(".css")) { $response.ContentType = "text/css; charset=utf-8" }
                    elseif ($filePath.EndsWith(".js")) { $response.ContentType = "application/javascript; charset=utf-8" }
                    elseif ($filePath.EndsWith(".png")) { $response.ContentType = "image/png" }
                    elseif ($filePath.EndsWith(".jpg") -or $filePath.EndsWith(".jpeg")) { $response.ContentType = "image/jpeg" }
                    elseif ($filePath.EndsWith(".ico")) { $response.ContentType = "image/x-icon" }
                    else { $response.ContentType = "application/octet-stream" }

                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    $response.StatusCode = 404
                    $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
                    $response.ContentLength64 = $errBytes.Length
                    $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
                }
            }
            # 1. API Route: Healthcheck
            elseif ($path -eq "/api/health" -and $method -eq "GET") {
                Write-JsonResponse $response 200 @{ success = $true; status = "ok"; project = "Mediwave Pharmacy Tracker PowerShell Server" }
            }
            
            # 2. API Route: Authentication login
            elseif ($path -eq "/api/auth/login" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $payload = ConvertFrom-Json $body

                $user = $db.users | Where-Object { $_.email.ToLower() -eq $payload.email.ToLower() }
                if ($null -eq $user -or ($payload.password -ne $user.password_plain)) {
                    Write-JsonResponse $response 400 @{ success = $false; message = "Wrong credentials. Please check your email and password."; code = 400 }
                } else {
                    $token = "mock-jwt-token-for-user-id-" + $user.id + "-role-" + $user.role
                    Add-AuditLog $db ("Session authenticated for representative: " + $user.email + " (" + $user.role.ToUpper() + ")")
                    Write-Database $db

                    Write-JsonResponse $response 200 @{
                        success = $true
                        token = $token
                        user = @{
                            id = $user.id
                            email = $user.email
                            name = $user.name
                            role = $user.role
                        }
                    }
                }
            }

            # 2b. API Route: Authentication Registration
            elseif ($path -eq "/api/auth/register" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $body = $reader.ReadToEnd()
                $reader.Close()
                $payload = ConvertFrom-Json $body

                if (!$payload.email -or !$payload.password -or !$payload.name) {
                    Write-JsonResponse $response 400 @{ success = $false; message = "All registration fields are required."; code = 400 }
                } else {
                    $existing = $db.users | Where-Object { $_.email.ToLower() -eq $payload.email.ToLower() }
                    if ($null -ne $existing) {
                        Write-JsonResponse $response 400 @{ success = $false; message = "A user with this email address already exists."; code = 400 }
                    } else {
                        $newId = $db.users.Length + 1
                        $newUser = @{
                            id = $newId
                            email = $payload.email
                            password_plain = $payload.password
                            name = $payload.name
                            role = "user"
                        }
                        $db.users = @($db.users) + @($newUser)
                        Add-AuditLog $db ("New representative registered: " + $payload.email)
                        Write-Database $db
                        Write-JsonResponse $response 201 @{ success = $true; message = "Registration successful. You can now log in." }
                    }
                }
            }

            # Authenticated Routes Gate check
            else {
                $currentUser = Get-AuthenticatedUser $request $db
                if ($null -eq $currentUser) {
                    Write-JsonResponse $response 401 @{ success = $false; message = "Access denied. Security clearance token is missing or expired."; code = 401 }
                }
                else {
                    # 3. Get System Config Rules
                    if ($path -eq "/api/config" -and $method -eq "GET") {
                        Write-JsonResponse $response 200 $db.config
                    }

                    # 4. Save Config Rules (Admin Only)
                    elseif ($path -eq "/api/config" -and $method -eq "PUT") {
                        if ($currentUser.role -ne "admin") {
                            Write-JsonResponse $response 403 @{ success = $false; message = "Access forbidden. Administrator clearance level required."; code = 403 }
                        } else {
                            $reader = New-Object System.IO.StreamReader($request.InputStream)
                            $body = $reader.ReadToEnd()
                            $reader.Close()
                            $payload = ConvertFrom-Json $body

                            $db.config.escalationDays = [int]$payload.escalationDays
                            $db.config.creditLimit = [double]$payload.creditLimit
                            $db.config.archiveDays = [int]$payload.archiveDays

                            Add-AuditLog $db ("System config modified: Escalation days = " + $db.config.escalationDays + ", Limit = " + $db.config.creditLimit + ", Archive = " + $db.config.archiveDays)
                            Write-Database $db

                            Write-JsonResponse $response 200 $db.config
                        }
                    }

                    # 4b. Update Profile
                    elseif ($path -eq "/api/auth/profile" -and $method -eq "PUT") {
                        $reader = New-Object System.IO.StreamReader($request.InputStream)
                        $body = $reader.ReadToEnd()
                        $reader.Close()
                        $payload = ConvertFrom-Json $body

                        if (!$payload.email -or !$payload.name) {
                            Write-JsonResponse $response 400 @{ success = $false; message = "Name and email fields are required."; code = 400 }
                        } else {
                            $existing = $db.users | Where-Object { $_.email.ToLower() -eq $payload.email.ToLower() -and $_.id -ne $currentUser.id }
                            if ($null -ne $existing) {
                                Write-JsonResponse $response 400 @{ success = $false; message = "A user with this email address already exists."; code = 400 }
                            } else {
                                # Find user by index and update
                                for ($i = 0; $i -lt $db.users.Length; $i++) {
                                    if ($db.users[$i].id -eq $currentUser.id) {
                                        $db.users[$i].name = $payload.name
                                        $db.users[$i].email = $payload.email
                                        if ($payload.password) {
                                            $db.users[$i].password_plain = $payload.password
                                        }
                                        break
                                    }
                                }

                                Add-AuditLog $db ("Profile updated for representative: " + $payload.email + " (" + $currentUser.role.ToUpper() + ")")
                                Write-Database $db

                                $updatedUser = $db.users | Where-Object { $_.id -eq $currentUser.id }

                                Write-JsonResponse $response 200 @{
                                    success = $true
                                    message = "Profile details updated successfully."
                                    user = @{
                                        id = $updatedUser.id
                                        email = $updatedUser.email
                                        name = $updatedUser.name
                                        role = $updatedUser.role
                                    }
                                }
                            }
                        }
                    }

                    # 5. List Pharmacy Vendors Index
                    elseif ($path -eq "/api/vendors" -and $method -eq "GET") {
                        Write-JsonResponse $response 200 $db.vendors
                    }

                    # 6. List System Users (Diagnostic view)
                    elseif ($path -eq "/api/users" -and $method -eq "GET") {
                        $roleFilter = $query["role"]
                        $userList = $db.users
                        if ($roleFilter) {
                            $userList = $db.users | Where-Object { $_.role -eq $roleFilter }
                        }
                        $sanitized = @()
                        foreach ($u in $userList) {
                            $sanitized += @{ id = $u.id; email = $u.email; name = $u.name; role = $u.role }
                        }
                        Write-JsonResponse $response 200 $sanitized
                    }

                    # 7. Get Audits Stream logs
                    elseif ($path -eq "/api/audit" -and $method -eq "GET") {
                        Write-JsonResponse $response 200 ($db.auditLogs | Select-Object -First 100)
                    }

                    # 8. Purge audits (Admin Only)
                    elseif ($path -eq "/api/audit" -and $method -eq "DELETE") {
                        if ($currentUser.role -ne "admin") {
                            Write-JsonResponse $response 403 @{ success = $false; message = "Access forbidden. Admin role required."; code = 403 }
                        } else {
                            $db.auditLogs = @()
                            Add-AuditLog $db ("Security audit logs purged by administrator: " + $currentUser.email)
                            Write-Database $db
                            Write-JsonResponse $response 200 @{ success = $true }
                        }
                    }

                    # 9. Reset Factory Diagnostics (Admin Only)
                    elseif ($path -eq "/api/reset" -and $method -eq "POST") {
                        if ($currentUser.role -ne "admin") {
                            Write-JsonResponse $response 403 @{ success = $false; message = "Access forbidden. Admin role required."; code = 403 }
                        } else {
                            $db = Read-Database
                            $db.credits = @(
                                @{ id = 1; vendor_id = 1; invoice_number = "INV-2026-1001"; invoice_date = "2026-05-10"; due_date = "2026-05-24"; amount_due = 45000.00; assigned_to_user_id = 2; status = "Active"; createdAt = "2026-05-10T10:00:00Z" }
                                @{ id = 2; vendor_id = 2; invoice_number = "INV-2026-1002"; invoice_date = "2026-06-01"; due_date = "2026-06-15"; amount_due = 28000.00; assigned_to_user_id = 2; status = "Completed"; createdAt = "2026-06-01T09:15:00Z" }
                                @{ id = 3; vendor_id = 3; invoice_number = "INV-2026-1003"; invoice_date = "2026-06-05"; due_date = "2026-06-20"; amount_due = 62000.00; assigned_to_user_id = 2; status = "Active"; createdAt = "2026-06-05T11:45:00Z" }
                                @{ id = 4; vendor_id = 4; invoice_number = "INV-2026-1004"; invoice_date = "2026-04-20"; due_date = "2026-05-10"; amount_due = 85000.00; assigned_to_user_id = 3; status = "Active"; createdAt = "2026-04-20T14:00:00Z" }
                                @{ id = 5; vendor_id = 5; invoice_number = "INV-2026-1005"; invoice_date = "2026-06-15"; due_date = "2026-07-15"; amount_due = 35000.00; assigned_to_user_id = 3; status = "Active"; createdAt = "2026-06-15T15:30:00Z" }
                            )
                            $db.payments = @(
                                @{ id = 1; credit_due_id = 1; payment_date = "2026-05-20"; amount_paid = 15000.00; payment_method = "UPI" }
                                @{ id = 2; credit_due_id = 2; payment_date = "2026-06-14"; amount_paid = 28000.00; payment_method = "Bank Transfer" }
                                @{ id = 3; credit_due_id = 3; payment_date = "2026-06-18"; amount_paid = 10000.00; payment_method = "Cheque" }
                                @{ id = 4; credit_due_id = 4; payment_date = "2026-05-05"; amount_paid = 25000.00; payment_method = "UPI" }
                            )
                            $db.auditLogs = @(
                                @{ time = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ"); message = "Diagnostics database factory reset triggered." }
                            )
                            Write-Database $db
                            Write-JsonResponse $response 200 @{ success = $true; message = "Database reset completed." }
                        }
                    }

                    # ======================================================
                    # OUTSTANDING CREDITS & COLLECTIONS (CORE LEDGER API)
                    # ======================================================
                    
                    # 10. Fetch Credits
                    elseif ($path -eq "/api/credits" -and $method -eq "GET") {
                        $result = @()
                        $credList = $db.credits
                        
                        # RBAC Scope filter: user only sees their own assigned credits
                        if ($currentUser.role -ne "admin") {
                            $credList = $db.credits | Where-Object { $_.assigned_to_user_id -eq $currentUser.id }
                        }

                        if ($credList) {
                            if ($credList -isnot [array]) { $credList = @($credList) }
                            
                            foreach ($c in $credList) {
                                # Calculate recovered payments sum
                                $pays = $db.payments | Where-Object { $_.credit_due_id -eq $c.id }
                                $recovered = 0.0
                                if ($pays) {
                                    if ($pays -isnot [array]) { $pays = @($pays) }
                                    foreach ($p in $pays) {
                                        $recovered += [double]$p.amount_paid
                                    }
                                }

                                # Calculate days overdue
                                $daysOverdue = 0
                                if ($c.status -eq "Active") {
                                    $dueDate = Get-Date $c.due_date
                                    if ($mockToday -gt $dueDate) {
                                        $diff = $mockToday - $dueDate
                                        $daysOverdue = [Math]::Ceiling($diff.TotalDays)
                                    }
                                }

                                # Calculate escalation flag
                                $isEsc = if ($c.status -eq "Active" -and $daysOverdue -gt $db.config.escalationDays) { 1 } else { 0 }

                                # Lookup vendor
                                $vendor = $db.vendors | Where-Object { $_.id -eq $c.vendor_id }
                                
                                # Lookup assigned rep
                                $rep = $db.users | Where-Object { $_.id -eq $c.assigned_to_user_id }

                                # Build payments list
                                $payArr = @()
                                if ($pays) {
                                    foreach ($p in $pays) {
                                        $payArr += @{
                                            id = $p.id
                                            amount_paid = [double]$p.amount_paid
                                            payment_date = $p.payment_date
                                            payment_method = $p.payment_method
                                        }
                                    }
                                }

                                # Build audit list
                                $auditList = @(
                                    @{ time = $c.createdAt; message = ("Initial database registration (Principal sum: " + $c.amount_due + ")") }
                                )
                                if ($pays) {
                                    foreach ($p in $pays) {
                                        $auditList += @{
                                            time = (Get-Date $p.payment_date).ToString("yyyy-MM-ddTHH:mm:ssZ")
                                            message = ("Logged collection installment of ₹" + $p.amount_paid + " via " + $p.payment_method)
                                        }
                                    }
                                }

                                $result += @{
                                    id = $c.id
                                    vendor_id = $c.vendor_id
                                    invoice_number = $c.invoice_number
                                    invoice_date = $c.invoice_date
                                    due_date = $c.due_date
                                    amount_due = [double]$c.amount_due
                                    amount_recovered = $recovered
                                    days_overdue = $daysOverdue
                                    escalation_flag = $isEsc
                                    assigned_to_user_id = $c.assigned_to_user_id
                                    assigned_rep_name = if ($rep) { $rep.name } else { "Unassigned" }
                                    status = $c.status
                                    vendor = @{
                                        name = $vendor.name
                                        city = $vendor.city
                                        state = $vendor.state
                                    }
                                    payments = $payArr
                                    audits = $auditList
                                }
                            }
                        }
                        Write-JsonResponse $response 200 $result
                    }

                    # 11. Add credit invoice
                    elseif ($path -eq "/api/credits" -and $method -eq "POST") {
                        $reader = New-Object System.IO.StreamReader($request.InputStream)
                        $body = $reader.ReadToEnd()
                        $reader.Close()
                        $payload = ConvertFrom-Json $body

                        if ($payload.amount_due -gt $db.config.creditLimit) {
                            Write-JsonResponse $response 400 @{ success = $false; message = ("Credit limit cap exceeded. Max limit ₹" + $db.config.creditLimit); code = 400 }
                        }
                        elseif ((Get-Date $payload.due_date) -lt (Get-Date $payload.invoice_date)) {
                            Write-JsonResponse $response 400 @{ success = $false; message = "Due date cannot precede the invoice date."; code = 400 }
                        }
                        else {
                            # Unique check
                            $existing = $db.credits | Where-Object { $_.invoice_number -eq $payload.invoice_number }
                            if ($null -ne $existing) {
                                Write-JsonResponse $response 400 @{ success = $false; message = "An invoice with this serial number is already registered."; code = 400 }
                            } else {
                                # Find the maximum ID in credits and add 1
                                $maxId = 0
                                foreach ($c in $db.credits) {
                                    if ($c.id -gt $maxId) { $maxId = $c.id }
                                }
                                $newId = $maxId + 1
                                $newCredit = @{
                                    id = $newId
                                    vendor_id = [int]$payload.vendor_id
                                    invoice_number = $payload.invoice_number
                                    invoice_date = $payload.invoice_date
                                    due_date = $payload.due_date
                                    amount_due = [double]$payload.amount_due
                                    assigned_to_user_id = [int]$currentUser.id
                                    status = "Active"
                                    createdAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
                                }
                                $db.credits = @($db.credits) + @($newCredit)
                                Add-AuditLog $db ("Logged credit invoice " + $payload.invoice_number + " (Rep: " + $currentUser.email + ")")
                                Write-Database $db

                                Write-JsonResponse $response 201 @{ success = $true; id = $newId; message = "Pharmacy credit invoice successfully logged." }
                            }
                        }
                    }

                    # 12. Edit record (Admin Only override)
                    elseif ($path -match "/api/credits/([^/]+)$" -and $method -eq "PUT") {
                        if ($currentUser.role -ne "admin") {
                            Write-JsonResponse $response 403 @{ success = $false; message = "Admin role required."; code = 403 }
                        } else {
                            $id = [long]$Matches[1]
                            $reader = New-Object System.IO.StreamReader($request.InputStream)
                            $body = $reader.ReadToEnd()
                            $reader.Close()
                            $payload = ConvertFrom-Json $body

                            $cred = $db.credits | Where-Object { $_.id -eq $id }
                            if ($null -eq $cred) {
                                Write-JsonResponse $response 404 @{ success = $false; message = "Record not found."; code = 404 }
                            } else {
                                if ($payload.amount_due -gt $db.config.creditLimit) {
                                    Write-JsonResponse $response 400 @{ success = $false; message = "Amount exceeds limit."; code = 400 }
                                } else {
                                    $cred.amount_due = [double]$payload.amount_due
                                    $cred.status = $payload.status
                                    Add-AuditLog $db ("Admin override on credit ID " + $id + ": Principal set to " + $cred.amount_due + ", status " + $cred.status)
                                    Write-Database $db
                                    Write-JsonResponse $response 200 @{ success = $true; message = "Record updated." }
                                }
                            }
                        }
                    }

                    # 13. Log payments installment
                    elseif ($path -match "/api/credits/([^/]+)/payments$" -and $method -eq "POST") {
                        $id = [long]$Matches[1]
                        $reader = New-Object System.IO.StreamReader($request.InputStream)
                        $body = $reader.ReadToEnd()
                        $reader.Close()
                        $payload = ConvertFrom-Json $body

                        $cred = $db.credits | Where-Object { $_.id -eq $id }
                        if ($null -eq $cred) {
                            Write-JsonResponse $response 404 @{ success = $false; message = "Credit record not found."; code = 404 }
                        } else {
                            # Verify scope guard
                            if ($currentUser.role -ne "admin" -and $cred.assigned_to_user_id -ne $currentUser.id) {
                                Write-JsonResponse $response 403 @{ success = $false; message = "Unauthorized access guard blocks transaction."; code = 403 }
                            } else {
                                # Calculate recovered
                                $pays = $db.payments | Where-Object { $_.credit_due_id -eq $id }
                                $recovered = 0.0
                                if ($pays) {
                                    if ($pays -isnot [array]) { $pays = @($pays) }
                                    foreach ($p in $pays) { $recovered += [double]$p.amount_paid }
                                }
                                $outstanding = $cred.amount_due - $recovered

                                if ([double]$payload.amount_paid -gt $outstanding) {
                                    Write-JsonResponse $response 400 @{ success = $false; message = "Payment amount exceeds outstanding ledger."; code = 400 }
                                } else {
                                    # Find the maximum ID in payments and add 1
                                    $maxPayId = 0
                                    foreach ($p in $db.payments) {
                                        if ($p.id -gt $maxPayId) { $maxPayId = $p.id }
                                    }
                                    $newPay = @{
                                        id = $maxPayId + 1
                                        credit_due_id = $id
                                        payment_date = $payload.payment_date
                                        amount_paid = [double]$payload.amount_paid
                                        payment_method = $payload.payment_method
                                    }
                                    $db.payments = @($db.payments) + @($newPay)
                                    Add-AuditLog $db ("Logged payment installment of ₹" + $payload.amount_paid + " for invoice " + $cred.invoice_number)

                                    $nextOutstanding = $outstanding - [double]$payload.amount_paid
                                    if ($nextOutstanding -le 0.01) {
                                        $cred.status = "Completed"
                                        Add-AuditLog $db ("Invoice " + $cred.invoice_number + " paid in full. Record marked Completed.")
                                    }
                                    Write-Database $db
                                    Write-JsonResponse $response 200 @{ success = $true }
                                }
                            }
                        }
                    }

                    # 14. Archive Completed File (Admin only)
                    elseif ($path -match "/api/credits/([^/]+)/archive$" -and $method -eq "PATCH") {
                        if ($currentUser.role -ne "admin") {
                            Write-JsonResponse $response 403 @{ success = $false; message = "Admin role required."; code = 403 }
                        } else {
                            $id = [long]$Matches[1]
                            $cred = $db.credits | Where-Object { $_.id -eq $id }
                            if ($null -eq $cred) {
                                Write-JsonResponse $response 404 @{ success = $false; message = "Record not found."; code = 404 }
                            } else {
                                if ($cred.status -ne "Completed") {
                                    Write-JsonResponse $response 400 @{ success = $false; message = "Invoice must be Completed before archiving."; code = 400 }
                                } else {
                                    $cred.status = "Archived"
                                    Add-AuditLog $db ("Credit invoice file " + $cred.invoice_number + " archived by admin: " + $currentUser.email)
                                    Write-Database $db
                                    Write-JsonResponse $response 200 @{ success = $true }
                                }
                            }
                        }
                    }

                    else {
                        Write-JsonResponse $response 404 @{ success = $false; message = "API Route Not Found"; code = 404 }
                    }
                }
            }
        }
        catch {
            Write-JsonResponse $response 500 @{ success = $false; message = $_.Exception.Message; code = 500 }
        }
    }
    catch {
        # Catch connection resets
    }
}
