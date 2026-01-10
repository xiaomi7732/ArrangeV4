using Microsoft.Graph;
using Microsoft.Identity.Client;
using Microsoft.Kiota.Abstractions;
using Microsoft.Kiota.Abstractions.Authentication;

namespace ConsoleProto;

public class MsalAuthenticationProvider : IAuthenticationProvider
{
    private readonly IPublicClientApplication _app;
    private readonly string[] _scopes;
    private IAccount? _account;

    public MsalAuthenticationProvider(IPublicClientApplication app, string[] scopes, IAccount? account = null)
    {
        _app = app;
        _scopes = scopes;
        _account = account;
    }

    public void SetAccount(IAccount account)
    {
        _account = account;
    }

    public async Task AuthenticateRequestAsync(RequestInformation request,
        Dictionary<string, object>? additionalAuthenticationContext = null,
        CancellationToken cancellationToken = default)
    {
        AuthenticationResult authResult;
        
        try
        {
            // Try silent authentication with existing account
            if (_account is not null)
            {
                authResult = await _app.AcquireTokenSilent(_scopes, _account).ExecuteAsync(cancellationToken);
            }
            // Try to use the Windows signed-in account
            else
            {
                authResult = await _app.AcquireTokenSilent(_scopes, PublicClientApplication.OperatingSystemAccount)
                    .ExecuteAsync(cancellationToken);
            }
        }
        catch (MsalUiRequiredException)
        {
            // Fall back to interactive authentication if silent fails
            authResult = await _app.AcquireTokenInteractive(_scopes).ExecuteAsync(cancellationToken);
        }
        
        _account = authResult.Account; // Update account in case it changed

        request.Headers.Add("Authorization", $"Bearer {authResult.AccessToken}");
    }
}
