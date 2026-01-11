using System.Runtime.InteropServices;

static class X11Interop
{
    [DllImport("libX11")]
    public static extern IntPtr XOpenDisplay(IntPtr display);

    [DllImport("libX11")]
    public static extern IntPtr XDefaultRootWindow(IntPtr display);

    public static IntPtr GetRootWindow()
    {
        IntPtr display = XOpenDisplay(IntPtr.Zero);
        if (display == IntPtr.Zero)
        {
            throw new InvalidOperationException("Unable to open X display.");
        }

        return XDefaultRootWindow(display);
    }
}