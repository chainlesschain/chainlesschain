# Cross-Platform U-Key Setup Guide

This guide explains how to set up hardware U-Key support on different platforms.

## Platform Support

| Platform | Native Drivers | PKCS#11 | Simulated |
|----------|---------------|---------|-----------|
| Windows  | ✅ Full       | ✅ Yes  | ✅ Yes    |
| macOS    | ❌ No         | ✅ Yes  | ✅ Yes    |
| Linux    | ❌ No         | ✅ Yes  | ✅ Yes    |

## Windows Setup

### Native Drivers (Recommended)

Windows users can use native drivers for best performance:

1. **XinJinKe U-Key**
   - Download driver from manufacturer
   - Install `xjk.dll` to `C:\Windows\System32\`
   - Or place in `resources/` folder

2. **FeiTian U-Key**
   - Install FeiTian driver package
   - DLL will be automatically detected

3. **Other Brands**
   - WatchData, Huada, TDR drivers supported
   - Follow manufacturer installation instructions

### PKCS#11 (Alternative)

For cross-platform compatibility:

```bash
# Download OpenSC installer
https://github.com/OpenSC/OpenSC/releases

# Install OpenSC
# Default location: C:\Program Files\OpenSC Project\OpenSC\
```

## macOS Setup

### Install OpenSC (Required for Hardware)

```bash
# Using Homebrew
brew install opensc

# Or download from:
https://github.com/OpenSC/OpenSC/releases

# Verify installation
pkcs11-tool --list-slots
```

### Install Node.js PKCS#11 Module

```bash
cd desktop-app-vue
npm install pkcs11js
```

### Supported Hardware

- YubiKey (all models with PIV)
- Nitrokey
- OpenPGP cards
- Any PKCS#11 compatible smart card

### Test Hardware Detection

```bash
# List available tokens
pkcs11-tool --list-slots

# Test with PIN (default: 123456)
pkcs11-tool --login --pin 123456 --list-objects
```

## Linux Setup

### Install OpenSC

#### Ubuntu/Debian
```bash
sudo apt-get update
sudo apt-get install opensc opensc-pkcs11
```

#### Fedora/RHEL
```bash
sudo dnf install opensc
```

#### Arch Linux
```bash
sudo pacman -S opensc
```

### Install Node.js PKCS#11 Module

```bash
cd desktop-app-vue
npm install pkcs11js
```

### Configure USB Permissions

Create udev rule for non-root access:

```bash
# Create udev rule
sudo nano /etc/udev/rules.d/90-smartcard.rules

# Add this line (replace VENDOR_ID and PRODUCT_ID):
SUBSYSTEM=="usb", ATTR{idVendor}=="VENDOR_ID", ATTR{idProduct}=="PRODUCT_ID", MODE="0666"

# Reload udev rules
sudo udevadm control --reload-rules
sudo udevadm trigger
```

### Test Hardware Detection

```bash
# List available tokens
pkcs11-tool --list-slots

# Test with PIN
pkcs11-tool --login --pin 123456 --list-objects
```

## Simulated Mode (All Platforms)

If no hardware is available, the app automatically uses simulated mode:

- No hardware required
- Full functionality for development/testing
- Data stored in encrypted file
- Default PIN: `123456`

### Enable Simulated Mode

```javascript
// In config
{
  driverType: 'simulated',
  defaultPin: '123456'
}
```

## Application Configuration

### Auto-Detection (Default)

The app automatically detects and uses the best available driver:

```javascript
// Automatic platform detection
const adapter = new CrossPlatformAdapter();
await adapter.initialize();
```

### Manual Driver Selection

```javascript
// Force specific driver
const adapter = new CrossPlatformAdapter({
  driverPreference: ['pkcs11', 'simulated']
});
await adapter.initialize();
```

### Check Available Drivers

```javascript
const info = adapter.getPlatformInfo();
console.log('Available drivers:', info.availableDrivers);
console.log('Current driver:', info.currentDriver);
console.log('Hardware supported:', info.isHardwareSupported);
```

## Troubleshooting

### macOS: "Library not found"

```bash
# Check OpenSC installation
ls -la /Library/OpenSC/lib/opensc-pkcs11.so

# If missing, reinstall OpenSC
brew reinstall opensc
```

### Linux: "Permission denied"

```bash
# Check USB permissions
lsusb
# Note vendor:product ID

# Add udev rule (see above)
# Or run with sudo (not recommended)
```

### Windows: "DLL not found"

```bash
# Check DLL location
dir "C:\Windows\System32\xjk.dll"

# Or place in app resources folder
copy xjk.dll desktop-app-vue\resources\
```

### All Platforms: "No tokens detected"

1. Check hardware is connected: `lsusb` (Linux/macOS) or Device Manager (Windows)
2. Verify driver installation: `pkcs11-tool --list-slots`
3. Try simulated mode for testing
4. Check application logs for detailed errors

## Security Notes

### PIN Management

- Default PIN: `123456` (change immediately!)
- Max retry attempts: 6 (hardware dependent)
- Locked tokens require admin unlock

### Data Encryption

- All data encrypted with AES-256
- Keys stored in hardware (PKCS#11)
- Or simulated secure storage (simulated mode)

### Best Practices

1. Change default PIN on first use
2. Use hardware tokens in production
3. Enable auto-lock after inactivity
4. Regular backup of encrypted data
5. Test disaster recovery procedures

## Development

### Testing Without Hardware

```bash
# Use simulated mode
npm run dev

# App will automatically use simulated driver
# No hardware required
```

### Testing With Hardware

```bash
# Install PKCS#11 tools
brew install opensc  # macOS
sudo apt install opensc  # Linux

# Verify hardware
pkcs11-tool --list-slots

# Run app
npm run dev
```

### Adding New Driver Support

1. Create driver class extending `BaseUKeyDriver`
2. Implement required methods (connect, sign, encrypt, etc.)
3. Add to `CrossPlatformAdapter` driver list
4. Update platform detection logic

## Support Matrix

### Tested Hardware

| Device | Windows | macOS | Linux | Notes |
|--------|---------|-------|-------|-------|
| XinJinKe | ✅ Native | ✅ PKCS#11 | ✅ PKCS#11 | Full support |
| FeiTian | ✅ Native | ✅ PKCS#11 | ✅ PKCS#11 | Full support |
| YubiKey | ✅ PKCS#11 | ✅ PKCS#11 | ✅ PKCS#11 | PIV mode |
| Nitrokey | ✅ PKCS#11 | ✅ PKCS#11 | ✅ PKCS#11 | Full support |
| Simulated | ✅ Yes | ✅ Yes | ✅ Yes | No hardware |

### Feature Support

| Feature | Native (Win) | PKCS#11 | Simulated |
|---------|-------------|---------|-----------|
| Digital Signature | ✅ | ✅ | ✅ |
| Encryption | ✅ | ✅ | ✅ |
| PIN Management | ✅ | ✅ | ✅ |
| Hot-plug Detection | ✅ | ⚠️ Limited | N/A |
| Multi-device | ✅ | ✅ | ✅ |

## Resources

- [OpenSC Project](https://github.com/OpenSC/OpenSC)
- [PKCS#11 Specification](http://docs.oasis-open.org/pkcs11/pkcs11-base/v2.40/os/pkcs11-base-v2.40-os.html)
- [YubiKey PIV Guide](https://developers.yubico.com/PIV/)
- [Node.js PKCS#11](https://github.com/PeculiarVentures/pkcs11js)

## License

Cross-platform U-Key support is part of ChainlessChain and follows the same license.
