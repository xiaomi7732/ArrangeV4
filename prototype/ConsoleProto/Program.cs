using ConsoleProto;
using Microsoft.Graph;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

var scopes = new[] { "User.Read", "Calendars.ReadWrite" };

BrokerOptions options = new(BrokerOptions.OperatingSystems.Windows)
{
    Title = "My Awesome Application"
};

IPublicClientApplication app =
    PublicClientApplicationBuilder.Create("0b4dbe1b-b67c-4ce1-b46b-d66832dc80b0")
    .WithAuthority("https://login.microsoftonline.com/consumers", validateAuthority: true)
    .WithDefaultRedirectUri()
    .WithParentActivityOrWindow(Native.GetConsoleOrTerminalWindow)
    .WithBroker(options)
    .Build();

// AuthenticationResult? result = null;

// Try to use the previously signed-in account from the cache
IEnumerable<IAccount> accounts = await app.GetAccountsAsync();
foreach (var acct in accounts)
{
    Console.WriteLine($"Found account: {acct.Username} ({acct.HomeAccountId?.Identifier}), env: {acct.Environment}");
}

IAccount? existingAccount = accounts.FirstOrDefault();

// try
// {
//     if (existingAccount != null)
//     {
//         result = await app.AcquireTokenSilent(scopes, existingAccount).ExecuteAsync();
//     }
//     // Next, try to sign in silently with the account that the user is signed into Windows
//     else
//     {
//         result = await app.AcquireTokenSilent(scopes, PublicClientApplication.OperatingSystemAccount)
//                             .ExecuteAsync();
//     }

// }
// // Can't get a token silently, go interactive
// catch (Exception ex)
// {
//     result = await app.AcquireTokenInteractive(scopes).ExecuteAsync().ConfigureAwait(false);
// }

// Console.WriteLine($"Access token:\n{result.AccessToken}");
// Console.WriteLine($"Signed in user: {result.Account.Username} ({result.Account.HomeAccountId?.Identifier}), env: {result.Account.Environment}");

// Create GraphServiceClient with MSAL authentication
var authProvider = new MsalAuthenticationProvider(app, scopes, existingAccount);
var graphClient = new GraphServiceClient(authProvider);

// Example: Get user info
var me = await graphClient.Me.GetAsync();
Console.WriteLine($"\nDisplay Name: {me?.DisplayName}");
Console.WriteLine($"Email: {me?.Mail ?? me?.UserPrincipalName}");