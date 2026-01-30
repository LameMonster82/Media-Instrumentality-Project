import { WASI, WASIProcExit } from '@bjorn3/browser_wasi_shim';
import { parseExifOutput } from './parse-exif-output';
import { PreopenDirectory, File } from '@bjorn3/browser_wasi_shim';
import { instantiate } from './asyncify.js';
import { Fd } from '@bjorn3/browser_wasi_shim';

//@ts-ignore
import zeroperlImport from "./zeroperl.wasm";
import type { Asset } from '../../Asset.js';

let zeroperl: ArrayBuffer | undefined;

class CustomFd extends Fd {
    private collectedOutput = '';

    override fd_write(data: Uint8Array): { ret: number; nwritten: number; } {
        const text = new TextDecoder().decode(data);
        console.log('WASI output:', text); // Debug output
        this.collectedOutput += text;
        return { ret: 0, nwritten: data.length };
    }

    getOutput(): string {
        return this.collectedOutput;
    }
}

async function runExifTools(file: Asset): Promise<{ label: string; value: string; }[]> {
    try {
        const fileName = file.handle.name;
        const imageData = await (await fetch(file.GetUrl())).arrayBuffer();

        const perlScript = `
        use Image::ExifTool;
        my $exifTool = new Image::ExifTool;

my $src = "SRC.EXT";
my $dst = "DST.xmp";

$exifTool->Options(Charset => "UTF8");
  my $xmp_data = $exifTool->ExtractInfo("${fileName}") && $exifTool->GetValue('XMP', 'Raw');

if ($xmp_data) {
    print $fh $xmp_data;
    close $fh;
    print "Wrote XMP data to $dst\n";
} else {
    die "No XMP data found in ${fileName}\n";
}
        `;

        const stdout = new CustomFd();
        const stderr = new CustomFd();

        // Create WASI instance with increased memory limits
        const wasi = new WASI(
            ['perl', '-e', perlScript],
            ['LC_ALL=1'], // Added PERL_UNICODE for better string handling
            [
                new CustomFd(), // stdin (fd 0)
                stdout, // stdout (fd 1)
                stderr, // stderr (fd 2)
                new PreopenDirectory('/dev', new Map([['null', new File(new Uint8Array())]])),
                new PreopenDirectory('', new Map([[fileName, new File(new Uint8Array(imageData), {readonly: true})]]))
            ],
            {
                debug: true
            }
        );

        // Set up imports with memory configuration
        const imports = {
            wasi_snapshot_preview1: wasi.wasiImport,
            env: {
                memory: new WebAssembly.Memory({
                    initial: 1000, // Initial memory in pages (6.4MB)
                    maximum: 10000, // Maximum memory in pages (64MB)
                    shared: false
                })
            }
        };

        zeroperl ??= await (await fetch(zeroperlImport)).arrayBuffer();

        console.log('Loading WASM...');
        const { instance } = await instantiate(zeroperl, imports);
        console.log('WASM loaded successfully');

        try {
            wasi.start(instance as { exports: { memory: WebAssembly.Memory; _start: () => void; }; });
        } catch (e) {
            if (e instanceof WASIProcExit) {
                console.log(`ExifTool exited with code ${e.code}`);
                if (e.code !== 0) {
                    console.error('ExifTool error:', stderr.getOutput());
                    throw new Error(`ExifTool exited with code ${e.code}`);
                }
            } else {
                throw e;
            }
        }

        const output = stdout.getOutput();
        console.log("Output:", output);
        console.error("Error:", stderr.getOutput());
        const parsedOutput = parseExifOutput(output);
        return parsedOutput;
    } catch (error) {
        console.error('Error running ExifTool:', error);
        throw new Error('Failed to run ExifTool');
    }
}

export { runExifTools };
