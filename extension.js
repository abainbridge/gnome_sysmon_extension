import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export default class SimpleCpuExtension extends Extension {
    enable() {
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // State tracking for CPU calculations and graph buffer
        this._prevIdle = 0;
        this._prevTotal = 0;
        this._dataPoints = new Array(10).fill(0);

        // Horizontal container box
        const box = new St.BoxLayout({
            vertical: false,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 1. Text Label
        this._label = new St.Label({
            text: 'cpu',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 6px;',
        });
        box.add_child(this._label);

        // 2. Line Graph Canvas (48x32)
        this._drawingArea = new St.DrawingArea({
            width: 48,
            height: 32,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._drawingArea.connect('repaint', (area) => {
            const cr = area.get_context();
            const [width, height] = area.get_surface_size();

            // 1. Fill background
            cr.setSourceRGB(0.10, 0.18, 0.28);
            cr.rectangle(0, 0, width, height);
            cr.fill();

            // 2. Draw line graph on top
            const points = this._dataPoints;
            const count = points.length;

            if (count >= 2) {
                // Set line stroke color (Light Blue) and thickness
                cr.setSourceRGB(0.35, 0.65, 1.0);
                cr.setLineWidth(1.5);

                const stepX = width / (count - 1);

                for (let i = 0; i < count; i++) {
                    const val = Math.max(0, Math.min(100, points[i]));
                    const x = i * stepX;
                    const y = height - (val / 100) * height;

                    if (i === 0) {
                        cr.moveTo(x, y);
                    } else {
                        cr.lineTo(x, y);
                    }
                }

                cr.stroke();
            }

            cr.$dispose();
        });

        box.add_child(this._drawingArea);
        this._indicator.add_child(box);

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Prime the initial read so the first delta calculation has baseline data
        this._updateCpuUsage();

        // 1-second polling timer
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._updateCpuUsage();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _getCpuStats() {
        try {
            // Read raw text from /proc/stat
            const [success, contents] = GLib.file_get_contents('/proc/stat');
            if (!success) return null;

            const text = new TextDecoder().decode(contents);
            const firstLine = text.split('\n')[0]; // "cpu  user nice system idle iowait..."
            const parts = firstLine.trim().split(/\s+/).slice(1).map(Number);

            // parts: [user, nice, system, idle, iowait, irq, softirq, steal]
            const idle = parts[3] + (parts[4] || 0); // idle + iowait
            const total = parts.reduce((acc, val) => acc + val, 0);

            return { idle, total };
        } catch (e) {
            console.error(`[SimpleCPU] Error reading /proc/stat: ${e}`);
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

                // Update text label
                this._label.set_text(`cpu`);

                // Shift buffer and queue canvas redraw
                this._dataPoints.shift();
                this._dataPoints.push(usage);
                this._drawingArea.queue_repaint();
            }
        }

        this._prevIdle = stats.idle;
        this._prevTotal = stats.total;
    }

    disable() {
        // Clean up GLib timeout source
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._label = null;
        this._drawingArea = null;
    }
}

