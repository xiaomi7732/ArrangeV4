using Microsoft.Identity.Client;

var scopes = new[] { "User.Read" };

BrokerOptions options = new(BrokerOptions.OperatingSystems.Windows)
{
    Title = "My Awesome Application"
};

IPublicClientApplication app =
    PublicClientApplicationBuilder.Create("0b4dbe1b-b67c-4ce1-b46b-d66832dc80b0")
    .WithDefaultRedirectUri()
    .WithParentActivityOrWindow(Native.GetConsoleOrTerminalWindow)
    .WithBroker(options)
    .Build();

AuthenticationResult result = null;

// Try to use the previously signed-in account from the cache
IEnumerable<IAccount> accounts = await app.GetAccountsAsync();
IAccount existingAccount = accounts.FirstOrDefault();

try
{    
    if (existingAccount != null)
    {
        result = await app.AcquireTokenSilent(scopes, existingAccount).ExecuteAsync();
    }
    // Next, try to sign in silently with the account that the user is signed into Windows
    else
    {    
        result = await app.AcquireTokenSilent(scopes, PublicClientApplication.OperatingSystemAccount)
                            .ExecuteAsync();
    }
}
// Can't get a token silently, go interactive
catch (MsalUiRequiredException ex)
{
    result = await app.AcquireTokenInteractive(scopes).ExecuteAsync();
}