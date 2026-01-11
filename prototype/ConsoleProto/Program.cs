using System.Runtime.InteropServices;
using ConsoleProto;
using Microsoft.Graph;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

string[] scopes = new[] { "User.Read", "Calendars.ReadWrite" };

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
foreach (IAccount acct in accounts)
{
    Console.WriteLine($"Found account: {acct.Username} ({acct.HomeAccountId?.Identifier}), env: {acct.Environment}");
}

IAccount? existingAccount = accounts.FirstOrDefault();

// Create GraphServiceClient with MSAL authentication
MsalAuthenticationProvider authProvider = new(app, scopes, existingAccount);
GraphServiceClient graphClient = new(authProvider);

// Example: Get user info
Microsoft.Graph.Models.User? me = await graphClient.Me.GetAsync();
Console.WriteLine($"\nDisplay Name: {me?.DisplayName}");
Console.WriteLine($"Email: {me?.Mail ?? me?.UserPrincipalName}");

// List all calendars:
var calendars = await graphClient.Me.Calendars.GetAsync();
Console.WriteLine("Calendars:");
if (calendars?.Value != null)
{
    foreach (var calendar in calendars.Value)
    {
        Console.WriteLine($"- {calendar.Name} (ID: {calendar.Id})");
    }
}
else
{
    Console.WriteLine("No calendars found.");
}

