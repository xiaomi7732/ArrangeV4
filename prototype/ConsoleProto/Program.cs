using System.Runtime.InteropServices;
using ConsoleProto;
using Microsoft.Graph;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

var scopes = new[] { "User.Read", "Calendars.ReadWrite" };

BrokerOptions options;
    options = new(BrokerOptions.OperatingSystems.Windows)
    {
        Title = "My Awesome Application"
    };

Func<IntPtr> getParentWindowFunc = Native.GetConsoleOrTerminalWindow;

PublicClientApplicationBuilder appBuilder = PublicClientApplicationBuilder.Create("0b4dbe1b-b67c-4ce1-b46b-d66832dc80b0")
    .WithAuthority("https://login.microsoftonline.com/consumers", validateAuthority: true)
    .WithDefaultRedirectUri();
 
if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
{
    appBuilder = appBuilder.WithParentActivityOrWindow(getParentWindowFunc)
        .WithBroker(options);
}
IPublicClientApplication app = appBuilder.Build();

// Try to use the previously signed-in account from the cache
IEnumerable<IAccount> accounts = await app.GetAccountsAsync();
foreach (var acct in accounts)
{
    Console.WriteLine($"Found account: {acct.Username} ({acct.HomeAccountId?.Identifier}), env: {acct.Environment}");
}

IAccount? existingAccount = accounts.FirstOrDefault();

// Create GraphServiceClient with MSAL authentication
var authProvider = new MsalAuthenticationProvider(app, scopes, existingAccount);
var graphClient = new GraphServiceClient(authProvider);

// Example: Get user info
var me = await graphClient.Me.GetAsync();
Console.WriteLine($"\nDisplay Name: {me?.DisplayName}");
Console.WriteLine($"Email: {me?.Mail ?? me?.UserPrincipalName}");