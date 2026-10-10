import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export default class SimpleCpuNetExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Container box to hold CPU and NET graphs side-by-side
        this._box = new St.BoxLayout({
            style_class: 'panel-status-indicators-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // --- CPU State & Setup ---
        this._prevIdle = 0;
        this._prevTotal = 0;
        this._cpuDataPoints = new Array(10).fill(0);

        this._cpuDrawingArea = new St.DrawingArea({
            width: 48,
            height: 32,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._cpuDrawingArea.connect('repaint', (area) => this._drawCpuGraph(area));

        // --- Network State & Setup ---
        this._prevRxBytes = 0;
        this._prevTxBytes = 0;
        this._prevNetTime = 0;
        this._rxDataPoints = new Array(10).fill(0);
        this._txDataPoints = new Array(10).fill(0);

        this._netDrawingArea = new St.DrawingArea({
            width: 48,
            height: 32,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._netDrawingArea.connect('repaint', (area) => this._drawNetGraph(area));

        // Add drawing areas to box and indicator
        this._box.add_child(this._cpuDrawingArea);
        this._box.add_child(this._netDrawingArea);
        this._indicator.add_child(this._box);

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Prime initial readings
        this._updateCpuUsage();
        this._updateNetUsage();

        // 1-second polling timer
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateCpuUsage();
            this._updateNetUsage();
            return GLib.SOURCE_CONTINUE;
        });
    }

    // --- CPU Drawing ---
    _drawCpuGraph(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();

        // Background
        cr.setSourceRGB(0.13, 0.28, 0.38);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        // Text "cpu"
        cr.save();
        const layout = PangoCairo.create_layout(cr);
        layout.set_text('cpu', -1);
        const fontDesc = Pango.FontDescription.from_string('Sans 12');
        layout.set_font_description(fontDesc);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.4);
        cr.translate(3, -2);
        cr.scale(1.0, 0.85);
        PangoCairo.show_layout(cr, layout);
        cr.restore();

        // Line Graph
        this._drawLinePath(cr, this._cpuDataPoints, [0.35, 0.65, 1.0], width, height, 100);

        cr.$dispose();
    }

    // --- Network Drawing ---
    _drawNetGraph(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();

        // Background
        cr.setSourceRGB(0.13, 0.28, 0.38);
        cr.rectangle(0, 0, width, height);
        cr.fill();

        // Text "net"
        cr.save();
        const layout = PangoCairo.create_layout(cr);
        layout.set_text('net', -1);
        const fontDesc = Pango.FontDescription.from_string('Sans 12');
        layout.set_font_description(fontDesc);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.4);
        cr.translate(3, -2);
        cr.scale(1.0, 0.85);
        PangoCairo.show_layout(cr, layout);
        cr.restore();

        // Maximum transformed y-axis scale
        const maxY = 1000;

        // Draw RX Line in Blue (0.2, 0.6, 1.0)
        this._drawLinePath(cr, this._rxDataPoints, [0.2, 0.6, 1.0], width, height, maxY);

        // Draw TX Line in Red (1.0, 0.3, 0.3)
        this._drawLinePath(cr, this._txDataPoints, [1.0, 0.3, 0.3], width, height, maxY);

        cr.$dispose();
    }

    // Common line drawing helper
    _drawLinePath(cr, dataPoints, colorRGB, width, height, maxValue) {
        const count = dataPoints.length;
        if (count < 2) return;

        cr.setSourceRGB(colorRGB[0], colorRGB[1], colorRGB[2]);
        cr.setLineWidth(1.5);

        const stepX = width / (count - 1);

        for (let i = 0; i < count; i++) {
            const val = Math.max(0, Math.min(maxValue, dataPoints[i]));
            const x = i * stepX;
            const y = height - (val / maxValue) * height;

            if (i === 0) {
                cr.moveTo(x, y);
            } else {
                cr.lineTo(x, y);
            }
        }

        cr.stroke();
    }

    // --- CPU Data Processing ---
    _getCpuStats() {
        try {
            const [success, contents] = GLib.file_get_contents('/proc/stat');
            if (!success) return null;

            const text = new TextDecoder().decode(contents);
            const firstLine = text.split('\n')[0];
            const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);

            const idle = parts[3] + (parts[4] || 0);
            const total = parts.reduce((acc, val) => acc + val, 0);

            return { idle, total };
        } catch (e) {
            console.error(`[SimpleCpuNet] Error reading /proc/stat: ${e}`);
            return null;
        }
    }

    _updateCpuUsage() {
        const stats = this._getCpuStats();
        if (!stats) return;

        if (this._prevTotal !== 0) {
            const deltaTotal = stats.total - this._prevTotal;
            const deltaIdle = stats.idle - this._prevIdle;

            if (deltaTotal > 0) {
                const usage = Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100);
                this._cpuDataPoints.shift();
                this._cpuDataPoints.push(usage);
                this._cpuDrawingArea.queue_repaint();
            }
        }

        this._prevIdle = stats.idle;
        this._prevTotal = stats.total;
    }

    // --- Network Data Processing ---
    _getNetStats() {
        try {
            const [success, contents] = GLib.file_get_contents('/proc/net/dev');
            if (!success) return null;

            const text = new TextDecoder().decode(contents);
            const lines = text.split('\n');

            let rxBytes = 0;
            let txBytes = 0;

            // Lines 0 and 1 are headers in /proc/net/dev
            for (let i = 2; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;

                const colonIdx = line.indexOf(':');
                if (colonIdx === -1) continue;

                const iface = line.substring(0, colonIdx).trim();
                // Ignore loopback interface
                if (iface === 'lo') continue;

                const parts = line.substring(colonIdx + 1).trim().split(/\s+/).map(Number);
                if (parts.length >= 9) {
                    rxBytes += parts[0]; // RX Bytes
                    txBytes += parts[8]; // TX Bytes
                }
            }

            return { rxBytes, txBytes };
        } catch (e) {
            console.error(`[SimpleCpuNet] Error reading /proc/net/dev: ${e}`);
            return null;
        }
    }

    _updateNetUsage() {
        const stats = this._getNetStats();
        const now = GLib.get_monotonic_time(); // microseconds

        if (!stats) return;

        if (this._prevNetTime !== 0) {
            const deltaTimeSec = (now - this._prevNetTime) / 1000000.0;

            if (deltaTimeSec > 0) {
                // Calculate throughput in bytes per second
                const rxSpeed = Math.max(0, (stats.rxBytes - this._prevRxBytes) / deltaTimeSec);
                const txSpeed = Math.max(0, (stats.txBytes - this._prevTxBytes) / deltaTimeSec);

                // Clamp to 10e6 B/s max and take the square root
                const rxTransformed = Math.sqrt(Math.min(1e6, rxSpeed));
                const txTransformed = Math.sqrt(Math.min(1e6, txSpeed));

                this._rxDataPoints.shift();
                this._rxDataPoints.push(rxTransformed);

                this._txDataPoints.shift();
                this._txDataPoints.push(txTransformed);

                this._netDrawingArea.queue_repaint();
            }
        }

        this._prevRxBytes = stats.rxBytes;
        this._prevTxBytes = stats.txBytes;
        this._prevNetTime = now;
    }

    disable() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._cpuDrawingArea = null;
        this._netDrawingArea = null;
        this._box = null;
    }
}
