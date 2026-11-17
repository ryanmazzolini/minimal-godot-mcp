import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  normalizeToWSLPath,
  normalizeToWindowsPath,
  normalizePath,
  detectWSL,
  isWSL,
} from '../src/path-utils.js';

const WSL2_PROC_VERSION =
  'Linux version 5.15.153.1-microsoft-standard-WSL2 (root@build) #1 SMP';
const WSL1_PROC_VERSION = 'Linux version 4.4.0-19041-Microsoft (root@build) #1 SMP';
const NATIVE_PROC_VERSION = 'Linux version 7.1.2-arch3-1 (linux@archlinux) #1 SMP PREEMPT';

describe('path-utils', () => {
  describe('normalizeToWSLPath', () => {
    it('should convert a forward-slash Windows path', () => {
      assert.strictEqual(normalizeToWSLPath('E:/Work/project'), '/mnt/e/Work/project');
    });

    it('should convert a backslash Windows path', () => {
      assert.strictEqual(normalizeToWSLPath('E:\\Work\\project'), '/mnt/e/Work/project');
    });

    it('should convert mixed separators', () => {
      assert.strictEqual(normalizeToWSLPath('E:/Work\\project/game.gd'), '/mnt/e/Work/project/game.gd');
    });

    it('should lowercase the drive letter', () => {
      assert.strictEqual(normalizeToWSLPath('C:/Users/dev'), '/mnt/c/Users/dev');
    });

    it('should accept an already-lowercase drive letter', () => {
      assert.strictEqual(normalizeToWSLPath('c:/Users/dev'), '/mnt/c/Users/dev');
    });

    it('should handle a bare drive root', () => {
      assert.strictEqual(normalizeToWSLPath('E:/'), '/mnt/e/');
    });

    it('should collapse duplicate slashes', () => {
      assert.strictEqual(normalizeToWSLPath('E://Work//project'), '/mnt/e/Work/project');
    });

    it('should preserve spaces in paths', () => {
      assert.strictEqual(normalizeToWSLPath('E:/My Games/project'), '/mnt/e/My Games/project');
    });

    it('should leave POSIX paths untouched', () => {
      assert.strictEqual(normalizeToWSLPath('/home/user/project'), '/home/user/project');
    });

    it('should leave already-converted WSL paths untouched', () => {
      assert.strictEqual(normalizeToWSLPath('/mnt/e/Work/project'), '/mnt/e/Work/project');
    });

    it('should leave relative paths untouched', () => {
      assert.strictEqual(normalizeToWSLPath('src/player.gd'), 'src/player.gd');
    });

    it('should leave UNC paths untouched', () => {
      assert.strictEqual(normalizeToWSLPath('\\\\server\\share'), '\\\\server\\share');
    });

    it('should leave a drive letter with no separator untouched', () => {
      // "E:foo" is a drive-relative path; there is no sane WSL equivalent.
      assert.strictEqual(normalizeToWSLPath('E:foo'), 'E:foo');
    });
  });

  describe('normalizeToWindowsPath', () => {
    it('should convert a WSL mount path', () => {
      assert.strictEqual(normalizeToWindowsPath('/mnt/e/Work/project'), 'E:/Work/project');
    });

    it('should uppercase the drive letter', () => {
      assert.strictEqual(normalizeToWindowsPath('/mnt/c/Users/dev'), 'C:/Users/dev');
    });

    it('should handle a bare mount root', () => {
      assert.strictEqual(normalizeToWindowsPath('/mnt/e/'), 'E:/');
    });

    it('should preserve spaces in paths', () => {
      assert.strictEqual(normalizeToWindowsPath('/mnt/e/My Games/p'), 'E:/My Games/p');
    });

    it('should leave non-mount POSIX paths untouched', () => {
      assert.strictEqual(normalizeToWindowsPath('/home/user/project'), '/home/user/project');
    });

    it('should leave Windows paths untouched', () => {
      assert.strictEqual(normalizeToWindowsPath('E:/Work/project'), 'E:/Work/project');
    });

    it('should leave a mount root with no trailing slash untouched', () => {
      // Documents current behaviour: the regex requires a slash after the drive.
      assert.strictEqual(normalizeToWindowsPath('/mnt/e'), '/mnt/e');
    });

    it('should leave an uppercase mount letter untouched', () => {
      // Documents current behaviour: WSL mounts are lowercase, so /mnt/E is
      // not treated as a drive mapping.
      assert.strictEqual(normalizeToWindowsPath('/mnt/E/Work'), '/mnt/E/Work');
    });
  });

  describe('roundtrip', () => {
    it('should roundtrip a Windows path through WSL form', () => {
      const original = 'E:/Work/project/game.gd';
      assert.strictEqual(normalizeToWindowsPath(normalizeToWSLPath(original)), original);
    });

    it('should roundtrip a WSL path through Windows form', () => {
      const original = '/mnt/e/Work/project/game.gd';
      assert.strictEqual(normalizeToWSLPath(normalizeToWindowsPath(original)), original);
    });
  });

  describe('detectWSL', () => {
    it('should detect WSL2 from /proc/version', () => {
      assert.strictEqual(detectWSL('linux', WSL2_PROC_VERSION), true);
    });

    it('should detect WSL1 from /proc/version regardless of case', () => {
      assert.strictEqual(detectWSL('linux', WSL1_PROC_VERSION), true);
    });

    it('should detect WSL from WSL_DISTRO_NAME when /proc/version is unreadable', () => {
      // The Godot-on-Windows case: no env inherited, but also sandboxes where
      // /proc is not mounted.
      assert.strictEqual(detectWSL('linux', null, 'Ubuntu'), true);
    });

    it('should prefer WSL_DISTRO_NAME over a native /proc/version', () => {
      assert.strictEqual(detectWSL('linux', NATIVE_PROC_VERSION, 'Ubuntu'), true);
    });

    it('should not detect WSL on native Linux', () => {
      assert.strictEqual(detectWSL('linux', NATIVE_PROC_VERSION), false);
    });

    it('should not detect WSL when /proc/version is unreadable and no env var', () => {
      assert.strictEqual(detectWSL('linux', null), false);
    });

    it('should treat an empty WSL_DISTRO_NAME as absent', () => {
      assert.strictEqual(detectWSL('linux', NATIVE_PROC_VERSION, ''), false);
    });

    it('should never report WSL on win32', () => {
      assert.strictEqual(detectWSL('win32', null, 'Ubuntu'), false);
    });

    it('should never report WSL on darwin', () => {
      assert.strictEqual(detectWSL('darwin', WSL2_PROC_VERSION, 'Ubuntu'), false);
    });
  });

  describe('isWSL', () => {
    it('should return a boolean', () => {
      assert.strictEqual(typeof isWSL(), 'boolean');
    });

    it('should be stable across calls (memoized)', () => {
      assert.strictEqual(isWSL(), isWSL());
    });

    it('should agree with detectWSL on the current environment', () => {
      assert.strictEqual(isWSL(), detectWSL(process.platform, procVersionOrNull(), process.env.WSL_DISTRO_NAME));
    });
  });

  describe('normalizePath', () => {
    it('should leave POSIX paths untouched on every platform', () => {
      assert.strictEqual(normalizePath('/home/user/project'), '/home/user/project');
    });

    if (isWSL()) {
      it('should convert Windows paths to WSL form under WSL', () => {
        assert.strictEqual(normalizePath('E:/Work/project'), '/mnt/e/Work/project');
      });
    } else if (process.platform === 'win32') {
      it('should convert WSL paths to Windows form on Windows', () => {
        assert.strictEqual(normalizePath('/mnt/e/Work/project'), 'E:/Work/project');
      });
    } else {
      it('should NOT rewrite drive-letter paths on native Linux or macOS', () => {
        // Regression: the original port branched on `process.platform === 'linux'`
        // alone, so a directory literally named "E:" on native Linux was rewritten
        // to the non-existent /mnt/e/... path.
        assert.strictEqual(normalizePath('E:/Work/project'), 'E:/Work/project');
      });

      it('should NOT rewrite /mnt paths on native Linux or macOS', () => {
        assert.strictEqual(normalizePath('/mnt/e/Work/project'), '/mnt/e/Work/project');
      });
    }
  });
});

function procVersionOrNull(): string | null {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return null;
  }
}
