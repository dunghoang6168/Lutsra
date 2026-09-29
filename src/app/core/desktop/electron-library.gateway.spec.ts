import { DesktopApi } from './desktop-api';
import { ElectronLibraryGateway } from './electron-library.gateway';
import { ScanProgress } from '../models';

describe('ElectronLibraryGateway', () => {
  let originalDesktop: DesktopApi | undefined;
  let progressListener: ((value: ScanProgress) => void) | undefined;

  beforeEach(() => {
    originalDesktop = window.desktop;
    const api = {
      runtime: 'electron',
      ping: jasmine.createSpy().and.resolveTo('pong'),
      library: {
        getSnapshot: jasmine.createSpy().and.resolveTo({ tracks: [], albums: [], artists: [], folders: [] }),
        getTrackById: jasmine.createSpy().and.resolveTo(null),
        getFolderTree: jasmine.createSpy().and.resolveTo(null),
        getTrackDetails: jasmine.createSpy().and.resolveTo({ trackId: 'track-test' }),
        selectAndAddFolders: jasmine.createSpy().and.resolveTo([]),
        removeFolder: jasmine.createSpy().and.resolveTo(),
        startScan: jasmine.createSpy().and.resolveTo(),
        onScanProgress: jasmine.createSpy().and.callFake((listener: (value: ScanProgress) => void) => { progressListener = listener; return () => undefined; }),
      },
      playlists: {},
      settings: {},
    } as unknown as DesktopApi;
    Object.defineProperty(window, 'desktop', { configurable: true, value: api });
  });

  afterEach(() => Object.defineProperty(window, 'desktop', { configurable: true, value: originalDesktop }));

  it('maps secure folder and scan operations to the preload API', async () => {
    const gateway = new ElectronLibraryGateway();
    const api = window.desktop!;
    await gateway.selectAndAddMusicFolders();
    await gateway.requestScan(['folder-' + 'a'.repeat(64)]);
    await gateway.getTrackDetails('track-' + 'b'.repeat(64));
    expect(api.library.selectAndAddFolders).toHaveBeenCalled();
    expect(api.library.startScan).toHaveBeenCalledWith(['folder-' + 'a'.repeat(64)]);
    expect(api.library.getTrackDetails).toHaveBeenCalledWith('track-' + 'b'.repeat(64));
  });

  it('forwards scan progress without exposing Electron event objects', () => {
    const gateway = new ElectronLibraryGateway();
    const values: ScanProgress[] = [];
    gateway.scanProgress$.subscribe((value) => values.push(value));
    progressListener?.({ isScanning: true, scannedFiles: 2, audioFiles: 1, currentPath: 'D:\\Music' });
    expect(values.at(-1)?.scannedFiles).toBe(2);
  });

  it('scans exactly the folders returned by the picker and signals changes', async () => {
    const gateway = new ElectronLibraryGateway();
    const api = window.desktop!;
    const changed = jasmine.createSpy('changed');
    gateway.libraryChanged$.subscribe(changed);
    const folders = [
      { id: 'folder-one', name: 'One', path: 'D:\\One', addedAt: 1 },
      { id: 'folder-two', name: 'Two', path: 'D:\\Two', addedAt: 2 },
    ];
    (api.library.selectAndAddFolders as jasmine.Spy).and.resolveTo(folders);
    await gateway.selectAndAddMusicFolders();
    expect(api.library.startScan).toHaveBeenCalledWith(['folder-one', 'folder-two']);
    expect(changed).toHaveBeenCalledTimes(1);
    progressListener?.({ isScanning: true, scannedFiles: 0, audioFiles: 0, currentPath: null });
    progressListener?.({ isScanning: false, scannedFiles: 2, audioFiles: 2, currentPath: null });
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('does not scan or signal a cancelled picker and surfaces picker errors', async () => {
    const gateway = new ElectronLibraryGateway();
    const api = window.desktop!;
    const changed = jasmine.createSpy('changed');
    gateway.libraryChanged$.subscribe(changed);
    await gateway.selectAndAddMusicFolders();
    expect(api.library.startScan).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    (api.library.selectAndAddFolders as jasmine.Spy).and.rejectWith(new Error('Picker failed'));
    await expectAsync(gateway.selectAndAddMusicFolders()).toBeRejectedWithError('Picker failed');
  });
});
