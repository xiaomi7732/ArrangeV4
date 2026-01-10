using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

var scopes = new[] { "User.Read", "Calendars.ReadWrite" };

BrokerOptions options = new(BrokerOptions.OperatingSystems.Windows)
{
    Title = "My Awesome Application"
};

IPublicClientApplication app =
    PublicClientApplicationBuilder.Create("0b4dbe1b-b67c-4ce1-b46b-d66832dc80b0")
    .WithTenantId("2c952286-1d8a-461a-bde8-3b0447c7691d")
    .WithRedirectUri("ms-appx-web://Microsoft.AAD.BrokerPlugin/0b4dbe1b-b67c-4ce1-b46b-d66832dc80b0")
    .WithParentActivityOrWindow(Native.GetConsoleOrTerminalWindow)
    .WithBroker(options)
    .Build();

AuthenticationResult result = null;

// Try to use the previously signed-in account from the cache
IEnumerable<IAccount> accounts = await app.GetAccountsAsync();
foreach(var acct in accounts)
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
    result = await app.AcquireTokenInteractive(scopes).ExecuteAsync();
// }

Console.WriteLine($"Access token:\n{result.AccessToken}");
Console.WriteLine($"Signed in user: {result.Account.Username} ({result.Account.HomeAccountId?.Identifier}), env: {result.Account.Environment}");