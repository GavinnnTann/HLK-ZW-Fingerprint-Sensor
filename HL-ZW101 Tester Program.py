"""
ZW101 Fingerprint Module Tester  [PyQt6]
Requires: pip install pyserial PyQt6
"""

import sys
import threading
import time
import struct
import pathlib

import serial
import serial.tools.list_ports

def _resource(rel):
    base = getattr(sys, '_MEIPASS', pathlib.Path(__file__).parent)
    return str(pathlib.Path(base) / rel)

_ICON = _resource("Images/Fingerprint ICO.ico")

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QTabWidget,
    QGroupBox, QLabel, QPushButton, QComboBox, QSpinBox,
    QProgressBar, QPlainTextEdit, QMessageBox, QLineEdit,
    QHBoxLayout, QVBoxLayout, QGridLayout,
    QSplitter, QFrame, QScrollArea, QFileDialog,
)
from PyQt6.QtCore import Qt, pyqtSignal, QSettings
from PyQt6.QtGui import QPainter, QColor, QFont, QPalette, QIcon

# ── Protocol constants ──────────────────────────────────────────────────────────
HEADER  = bytes([0xEF, 0x01])
ADDR    = bytes([0xFF, 0xFF, 0xFF, 0xFF])
PID_CMD = 0x01
PID_ACK = 0x07

FINGERPRINT_GETIMAGE       = 0x01
FINGERPRINT_IMAGE2TZ       = 0x02
FINGERPRINT_SEARCH         = 0x04
FINGERPRINT_REGMODEL       = 0x05
FINGERPRINT_STORE          = 0x06
FINGERPRINT_LOAD           = 0x07
FINGERPRINT_UPCHAR         = 0x08
FINGERPRINT_DOWNCHAR       = 0x09
FINGERPRINT_DELETE         = 0x0C
FINGERPRINT_EMPTY          = 0x0D
FINGERPRINT_WRITE_REG      = 0x0E
FINGERPRINT_READSYSPARAM   = 0x0F
FINGERPRINT_SETPASSWORD    = 0x12
FINGERPRINT_VERIFYPASSWORD = 0x13
FINGERPRINT_HISPEEDSEARCH  = 0x1B
FINGERPRINT_TEMPLATECOUNT  = 0x1D
FINGERPRINT_READ_INDEX     = 0x1F
FINGERPRINT_AURALEDCONFIG  = 0x3C
FINGERPRINT_LEDON          = 0x50
FINGERPRINT_LEDOFF         = 0x51

CONFIRM = {
    0x00: "OK",
    0x01: "Packet receive error",
    0x02: "No finger on sensor",
    0x03: "Image capture failed",
    0x06: "Image too messy",
    0x07: "Feature extraction failed",
    0x08: "No match",
    0x09: "Not found in library",
    0x0A: "Enroll mismatch — scans didn't match",
    0x0B: "Bad page ID / location out of range",
    0x0C: "DB read error / template not found",
    0x0D: "Upload feature failed",
    0x0E: "Module cannot accept packets",
    0x0F: "Upload image failed",
    0x10: "Delete failed",
    0x11: "Library clear failed",
    0x13: "Wrong password",
    0x15: "Invalid image",
    0x18: "Flash write error",
    0x1A: "Invalid register number",
    0x21: "Password verify error",
    0xFE: "Bad packet",
    0xFF: "Timeout",
}


# ── Packet helpers ──────────────────────────────────────────────────────────────

def fps_checksum(pid, len_bytes, body):
    return (pid + sum(len_bytes) + sum(body)) & 0xFFFF


def build_packet(ins, params=b''):
    body = bytes([ins]) + params
    lb   = struct.pack('>H', len(body) + 2)
    cs   = struct.pack('>H', fps_checksum(PID_CMD, lb, body))
    return HEADER + ADDR + bytes([PID_CMD]) + lb + body + cs


def parse_response(buf):
    if len(buf) < 12:
        raise ValueError(f"Too short ({len(buf)} bytes)")
    if buf[:2] != HEADER:
        raise ValueError(f"Bad header: {buf[:2].hex().upper()}")
    pid    = buf[6]
    length = struct.unpack('>H', buf[7:9])[0]
    if len(buf) < 9 + length:
        raise ValueError("Truncated body")
    body    = buf[9 : 9 + length - 2]
    cs_recv = struct.unpack('>H', buf[9 + length - 2 : 9 + length])[0]
    cs_calc = fps_checksum(pid, buf[7:9], body)
    if cs_calc != cs_recv:
        raise ValueError("Checksum mismatch")
    if not body:
        raise ValueError("Empty body")
    return body[0], body[1:]


# ── Storage map widget ──────────────────────────────────────────────────────────

class StorageMapWidget(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self._states = [False] * 50
        self.setMinimumHeight(75)
        self.setMinimumWidth(300)

    def set_states(self, states):
        self._states = list(states)
        self.update()

    def paintEvent(self, _event):
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing, False)
        p.fillRect(self.rect(), QColor("#1e1e1e"))
        w    = self.width()
        cols = 25
        cell = max(1, w // cols)
        pad  = 3
        for i in range(50):
            col = i % cols
            row = i // cols
            x  = col * cell + pad
            y  = row * cell + pad
            cw = max(1, cell - pad)
            ch = max(1, cell - pad)
            fill = QColor("#00cc44") if (i < len(self._states) and self._states[i]) else QColor("#333333")
            p.fillRect(x, y, cw, ch, fill)
            p.setPen(QColor("#555555"))
            p.drawRect(x, y, cw, ch)
            p.setPen(QColor("white"))
            p.setFont(QFont("", 7))
            p.drawText(x, y, cw, ch, Qt.AlignmentFlag.AlignCenter, str(i))
        p.end()


# ── Theme ───────────────────────────────────────────────────────────────────────

_SYSTEM_STYLE   = None
_SYSTEM_PALETTE = None


def apply_theme(app: QApplication, theme: str):
    global _SYSTEM_STYLE, _SYSTEM_PALETTE
    # Snapshot the original system theme the first time we're called
    if _SYSTEM_STYLE is None:
        _SYSTEM_STYLE   = app.style().objectName()
        _SYSTEM_PALETTE = QPalette(app.palette())

    if theme == "dark":
        app.setStyle("Fusion")
        pal = QPalette()
        pal.setColor(QPalette.ColorRole.Window,          QColor(45,  45,  45))
        pal.setColor(QPalette.ColorRole.WindowText,      QColor(220, 220, 220))
        pal.setColor(QPalette.ColorRole.Base,            QColor(28,  28,  28))
        pal.setColor(QPalette.ColorRole.AlternateBase,   QColor(45,  45,  45))
        pal.setColor(QPalette.ColorRole.Text,            QColor(220, 220, 220))
        pal.setColor(QPalette.ColorRole.Button,          QColor(55,  55,  55))
        pal.setColor(QPalette.ColorRole.ButtonText,      QColor(220, 220, 220))
        pal.setColor(QPalette.ColorRole.BrightText,      QColor(255, 100, 100))
        pal.setColor(QPalette.ColorRole.Highlight,       QColor(42,  130, 218))
        pal.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
        pal.setColor(QPalette.ColorRole.Link,            QColor(42,  130, 218))
        pal.setColor(QPalette.ColorRole.ToolTipBase,     QColor(30,  30,  30))
        pal.setColor(QPalette.ColorRole.ToolTipText,     QColor(220, 220, 220))
        app.setPalette(pal)

    elif theme == "light":
        app.setStyle("Fusion")
        pal = QPalette()
        pal.setColor(QPalette.ColorRole.Window,          QColor(240, 240, 240))
        pal.setColor(QPalette.ColorRole.WindowText,      QColor(0,   0,   0))
        pal.setColor(QPalette.ColorRole.Base,            QColor(255, 255, 255))
        pal.setColor(QPalette.ColorRole.AlternateBase,   QColor(245, 245, 245))
        pal.setColor(QPalette.ColorRole.Text,            QColor(0,   0,   0))
        pal.setColor(QPalette.ColorRole.Button,          QColor(240, 240, 240))
        pal.setColor(QPalette.ColorRole.ButtonText,      QColor(0,   0,   0))
        pal.setColor(QPalette.ColorRole.BrightText,      QColor(200, 0,   0))
        pal.setColor(QPalette.ColorRole.Highlight,       QColor(0,   120, 215))
        pal.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
        pal.setColor(QPalette.ColorRole.Link,            QColor(0,   100, 200))
        pal.setColor(QPalette.ColorRole.ToolTipBase,     QColor(255, 255, 220))
        pal.setColor(QPalette.ColorRole.ToolTipText,     QColor(0,   0,   0))
        app.setPalette(pal)

    else:  # system — restore exactly what was there on startup
        app.setStyle(_SYSTEM_STYLE)
        app.setPalette(QPalette(_SYSTEM_PALETTE))


# ── Main window ─────────────────────────────────────────────────────────────────

class App(QMainWindow):
    # Signal for safe cross-thread UI updates: emit a callable, slot calls it
    _ui_signal = pyqtSignal(object)

    def __init__(self):
        super().__init__()
        self._ui_signal.connect(lambda fn: fn())
        self.setWindowTitle("HL-ZW101 Fingerprint Tester")
        self.setWindowIcon(QIcon(_ICON))
        self.resize(1020, 820)
        self.ser   = None
        self.lock  = threading.Lock()
        self._map_states    = [False] * 50
        self._enroll_cancel = threading.Event()
        self._build()
        self.statusBar().addPermanentWidget(QLabel("by @GavinnnTann"))

    def _ui(self, fn):
        """Schedule fn() on the main thread from any thread."""
        self._ui_signal.emit(fn)

    # ── UI ──────────────────────────────────────────────────────────────────────

    def _build(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setSpacing(6)
        root.setContentsMargins(8, 8, 8, 8)

        root.addWidget(self._build_conn_bar())

        tabs = QTabWidget()
        self._build_device_tab(tabs)
        self._build_settings_tab(tabs)

        splitter = QSplitter(Qt.Orientation.Vertical)
        splitter.addWidget(tabs)
        splitter.addWidget(self._build_log())
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 0)
        splitter.setSizes([580, 200])
        root.addWidget(splitter, stretch=1)

        self.refresh_ports()

    def _build_conn_bar(self):
        box = QGroupBox("Connection")
        lay = QHBoxLayout(box)
        lay.setSpacing(8)

        lay.addWidget(QLabel("Port:"))
        self.port_cb = QComboBox()
        self.port_cb.setMinimumWidth(100)
        lay.addWidget(self.port_cb)

        lay.addWidget(QLabel("Baud:"))
        self.baud_cb = QComboBox()
        for b in ["9600", "19200", "38400", "57600", "115200"]:
            self.baud_cb.addItem(b)
        self.baud_cb.setCurrentText("57600")
        lay.addWidget(self.baud_cb)

        sep = QFrame(); sep.setFrameShape(QFrame.Shape.VLine); sep.setFrameShadow(QFrame.Shadow.Sunken)
        lay.addWidget(sep)

        lay.addWidget(QLabel("Password:"))
        self.conn_password = QLineEdit("00000000")
        self.conn_password.setMaxLength(8)
        self.conn_password.setPlaceholderText("00000000")
        self.conn_password.setFixedWidth(90)
        self.conn_password.setToolTip("4-byte module password as 8 hex chars. Default: 00000000")
        lay.addWidget(self.conn_password)

        ref = QPushButton("Refresh"); ref.clicked.connect(self.refresh_ports)
        lay.addWidget(ref)
        self.conn_btn = QPushButton("Connect"); self.conn_btn.clicked.connect(self.toggle_connect)
        lay.addWidget(self.conn_btn)
        self.conn_lbl = QLabel("● Disconnected")
        self.conn_lbl.setStyleSheet("color: red; font-weight: bold;")
        lay.addWidget(self.conn_lbl)
        lay.addStretch()
        return box

    def _build_device_tab(self, tabs):
        tab = QWidget()
        tabs.addTab(tab, "Device & Manage")
        grid = QGridLayout(tab)
        grid.setSpacing(6)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 2)

        # ── Row 0 Col 0: Device Info ───────────────────────────────────────
        dev_box = QGroupBox("Device Info")
        dev_lay = QHBoxLayout(dev_box)

        btn_col = QVBoxLayout()
        for text, slot in [
            ("Verify Password",      self.cmd_verify_password),
            ("Read System Params",   self.cmd_read_sys_param),
            ("Get Template Count",   self.cmd_get_count),
            ("Check Finger Present", self.cmd_query_finger),
        ]:
            b = QPushButton(text); b.clicked.connect(slot)
            btn_col.addWidget(b)
        btn_col.addStretch()
        dev_lay.addLayout(btn_col)

        sep = QFrame()
        sep.setFrameShape(QFrame.Shape.VLine)
        sep.setFrameShadow(QFrame.Shadow.Sunken)
        dev_lay.addWidget(sep)

        info_grid = QGridLayout()
        info_grid.setSpacing(4)
        info_grid.setColumnMinimumWidth(0, 70)
        for row, key in enumerate(["Status", "Module", "Templates"]):
            lbl = QLabel(f"{key}:"); lbl.setStyleSheet("color: gray;")
            info_grid.addWidget(lbl, row, 0)
        self.dev_status_lbl = QLabel("—")
        self.dev_params_lbl = QLabel("—")
        self.dev_params_lbl.setWordWrap(True)
        self.dev_params_lbl.setMaximumWidth(230)
        self.dev_count_lbl  = QLabel("—")
        info_grid.addWidget(self.dev_status_lbl, 0, 1)
        info_grid.addWidget(self.dev_params_lbl, 1, 1)
        info_grid.addWidget(self.dev_count_lbl,  2, 1)
        dev_lay.addLayout(info_grid)
        dev_lay.addStretch()
        grid.addWidget(dev_box, 0, 0)

        # ── Row 0 Col 1: Template Management ──────────────────────────────
        mgmt_box   = QGroupBox("Template Management")
        mgmt_outer = QVBoxLayout(mgmt_box)

        mgmt_row1 = QHBoxLayout()

        chk_box = QGroupBox("Check ID")
        chk_lay = QVBoxLayout(chk_box)
        r = QHBoxLayout(); r.addWidget(QLabel("ID:"))
        self.chk_id = QSpinBox(); self.chk_id.setRange(0, 49)
        r.addWidget(self.chk_id); chk_lay.addLayout(r)
        b = QPushButton("Check Exists"); b.clicked.connect(self.cmd_check_exists)
        chk_lay.addWidget(b)
        mgmt_row1.addWidget(chk_box)

        del1_box = QGroupBox("Delete Single")
        del1_lay = QVBoxLayout(del1_box)
        r = QHBoxLayout(); r.addWidget(QLabel("ID:"))
        self.del_id = QSpinBox(); self.del_id.setRange(0, 49)
        r.addWidget(self.del_id); del1_lay.addLayout(r)
        b = QPushButton("Delete"); b.clicked.connect(self.cmd_delete_single)
        del1_lay.addWidget(b)
        mgmt_row1.addWidget(del1_box)

        delr_box = QGroupBox("Delete Range")
        delr_lay = QVBoxLayout(delr_box)
        r = QHBoxLayout()
        r.addWidget(QLabel("First:"))
        self.del_first = QSpinBox(); self.del_first.setRange(0, 49)
        r.addWidget(self.del_first)
        r.addWidget(QLabel("Last:"))
        self.del_last = QSpinBox(); self.del_last.setRange(0, 49); self.del_last.setValue(9)
        r.addWidget(self.del_last); delr_lay.addLayout(r)
        b = QPushButton("Delete Range"); b.clicked.connect(self.cmd_delete_range)
        delr_lay.addWidget(b)
        mgmt_row1.addWidget(delr_box)

        wipe_box = QGroupBox("⚠  Wipe All")
        wipe_lay = QVBoxLayout(wipe_box)
        wl = QLabel("Permanently erases\nevery stored fingerprint.")
        wl.setStyleSheet("color: #cc3300;"); wl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        wipe_lay.addWidget(wl)
        b = QPushButton("WIPE ALL FINGERPRINTS"); b.clicked.connect(self.cmd_delete_all)
        wipe_lay.addWidget(b)
        mgmt_row1.addWidget(wipe_box)
        mgmt_outer.addLayout(mgmt_row1)

        mgmt_row2 = QHBoxLayout()

        exp_box = QGroupBox("Export Template")
        exp_lay = QVBoxLayout(exp_box)
        r = QHBoxLayout(); r.addWidget(QLabel("ID:"))
        self.export_id_spin = QSpinBox(); self.export_id_spin.setRange(0, 49)
        r.addWidget(self.export_id_spin); r.addStretch()
        exp_lay.addLayout(r)
        b = QPushButton("Export to File"); b.clicked.connect(self.cmd_export)
        exp_lay.addWidget(b)
        mgmt_row2.addWidget(exp_box)

        imp_box = QGroupBox("Import Template")
        imp_lay = QVBoxLayout(imp_box)
        r = QHBoxLayout(); r.addWidget(QLabel("To ID:"))
        self.import_id_spin = QSpinBox(); self.import_id_spin.setRange(0, 49)
        r.addWidget(self.import_id_spin); r.addStretch()
        imp_lay.addLayout(r)
        b = QPushButton("Import from File"); b.clicked.connect(self.cmd_import)
        imp_lay.addWidget(b)
        mgmt_row2.addWidget(imp_box)

        mgmt_row2.addStretch()
        mgmt_outer.addLayout(mgmt_row2)
        grid.addWidget(mgmt_box, 0, 1)

        # ── Row 1 Col 0: Enrollment ────────────────────────────────────────
        enroll_box = QGroupBox("Enrollment")
        enroll_lay = QVBoxLayout(enroll_box)

        opt_row = QHBoxLayout()
        opt_row.addWidget(QLabel("Target ID (0–49):"))
        self.enroll_id = QSpinBox(); self.enroll_id.setRange(0, 49)
        opt_row.addWidget(self.enroll_id)
        hint = QLabel("Scan the same finger twice. Lift between scans.")
        hint.setStyleSheet("color: gray;")
        opt_row.addWidget(hint); opt_row.addStretch()
        enroll_lay.addLayout(opt_row)

        ebtn_row = QHBoxLayout()
        self.enroll_btn = QPushButton("▶  Start Enrollment")
        self.enroll_btn.clicked.connect(self.cmd_enroll)
        ebtn_row.addWidget(self.enroll_btn)
        b = QPushButton("✕  Cancel"); b.clicked.connect(self.cmd_cancel_enroll)
        ebtn_row.addWidget(b); ebtn_row.addStretch()
        enroll_lay.addLayout(ebtn_row)

        self.enroll_prog = QProgressBar()
        self.enroll_prog.setRange(0, 10); self.enroll_prog.setValue(0)
        enroll_lay.addWidget(self.enroll_prog)
        self.enroll_lbl = QLabel("Ready — click Start Enrollment")
        enroll_lay.addWidget(self.enroll_lbl)
        grid.addWidget(enroll_box, 1, 0)

        # ── Row 1 Col 1: Storage Map ───────────────────────────────────────
        map_box = QGroupBox("Storage Map  (● = enrolled)")
        map_lay = QVBoxLayout(map_box)
        b = QPushButton("Refresh Map"); b.setMaximumWidth(120)
        b.clicked.connect(self.cmd_storage_map)
        map_lay.addWidget(b, alignment=Qt.AlignmentFlag.AlignLeft)
        self.map_widget = StorageMapWidget()
        map_lay.addWidget(self.map_widget)
        grid.addWidget(map_box, 1, 1)

        # ── Row 2 Col 0: Verification ──────────────────────────────────────
        verify_box = QGroupBox("Verification")
        verify_lay = QVBoxLayout(verify_box)
        verify_lay.addWidget(QLabel("Place finger on sensor, then click Match."))
        vbtn_row = QHBoxLayout()
        b = QPushButton("Match"); b.clicked.connect(self.cmd_match)
        vbtn_row.addWidget(b)
        vbtn_row.addWidget(QLabel("Timeout (s):"))
        self.match_timeout = QSpinBox()
        self.match_timeout.setRange(1, 60); self.match_timeout.setValue(10)
        vbtn_row.addWidget(self.match_timeout)
        self.match_result = QLabel("—")
        self.match_result.setStyleSheet("font-weight: bold; font-size: 14px;")
        vbtn_row.addWidget(self.match_result)
        self.match_detail = QLabel("")
        vbtn_row.addWidget(self.match_detail)
        vbtn_row.addStretch()
        verify_lay.addLayout(vbtn_row)
        grid.addWidget(verify_box, 2, 0)

        # ── Row 2 Col 1: LED ───────────────────────────────────────────────
        led_box = QGroupBox("LED")
        led_lay = QVBoxLayout(led_box)

        led_opts = QHBoxLayout()
        led_opts.addWidget(QLabel("Color:"))
        self.led_color_cb = QComboBox()
        for item in ["1 (Red)", "2 (Blue)", "3 (Purple)", "4 (Green)",
                     "5 (Cyan)", "6 (Yellow)", "7 (White)"]:
            self.led_color_cb.addItem(item)
        self.led_color_cb.setCurrentIndex(1)
        self.led_color_cb.setMinimumWidth(120)
        led_opts.addWidget(self.led_color_cb)
        led_opts.addWidget(QLabel("Cycles:"))
        self.led_cycles_spin = QSpinBox()
        self.led_cycles_spin.setRange(0, 255); self.led_cycles_spin.setValue(0)
        led_opts.addWidget(self.led_cycles_spin)
        inf_lbl = QLabel("(0 = ∞, breathing/flash only)")
        inf_lbl.setStyleSheet("color: gray;")
        led_opts.addWidget(inf_lbl); led_opts.addStretch()
        led_lay.addLayout(led_opts)

        led_btns = QHBoxLayout()
        for text, slot in [
            ("Breathing",  self.cmd_led_breathing),
            ("Flash",      self.cmd_led_flash),
            ("Steady On",  self.cmd_led_steady),
            ("Grad Open",  self.cmd_led_grad_open),
            ("Grad Close", self.cmd_led_grad_close),
            ("Off",        self.cmd_led_off_simple),
        ]:
            b = QPushButton(text); b.clicked.connect(slot)
            led_btns.addWidget(b)
        led_btns.addStretch()
        led_lay.addLayout(led_btns)
        grid.addWidget(led_box, 2, 1)

    def _build_settings_tab(self, tabs):
        tab = QWidget()
        tabs.addTab(tab, "Settings")
        outer = QVBoxLayout(tab)
        outer.setContentsMargins(0, 0, 0, 0)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        outer.addWidget(scroll)

        content = QWidget()
        lay = QVBoxLayout(content)
        lay.setSpacing(8)
        lay.setContentsMargins(8, 8, 8, 8)
        scroll.setWidget(content)

        # Theme
        theme_box = QGroupBox("Theme")
        theme_lay = QHBoxLayout(theme_box)
        theme_lay.addWidget(QLabel("Theme:"))
        self.theme_cb = QComboBox()
        self.theme_cb.addItems(["System", "Light", "Dark"])
        self.theme_cb.setMinimumWidth(120)
        self.theme_cb.currentTextChanged.connect(
            lambda t: (apply_theme(QApplication.instance(), t.lower()),
                       QSettings("GavinnnTann", "HLK-ZW101-Tester").setValue("theme", t.lower())))
        theme_lay.addWidget(self.theme_cb)
        theme_lay.addStretch()
        lay.addWidget(theme_box)

        # Risk warning
        risk_box = QGroupBox("⚠  Risk Warning")
        risk_lbl = QLabel(
            "All settings on this page are written directly to module flash and persist after power cycle.\n"
            "• Baud rate: if you set an incorrect value you must reconnect at the new rate to recover.\n"
            "• Security level: permanently changes the false-accept / false-reject threshold.\n"
            "• Packet size: affects all subsequent communication. Mismatch may break the connection.\n"
            "• Password: enforcement varies by firmware — leave at default (00000000) if unsure."
        )
        risk_lbl.setStyleSheet("color: #cc3300;"); risk_lbl.setWordWrap(True)
        QVBoxLayout(risk_box).addWidget(risk_lbl)
        lay.addWidget(risk_box)

        # System parameters
        sp_box = QGroupBox("System Parameters")
        sp_lay = QHBoxLayout(sp_box)
        self.sys_lbl = QLabel("(not read yet)"); self.sys_lbl.setWordWrap(True)
        sp_lay.addWidget(self.sys_lbl, stretch=1)
        b = QPushButton("Read System Params"); b.clicked.connect(self.cmd_read_sys_param)
        sp_lay.addWidget(b)
        lay.addWidget(sp_box)

        # Security level
        sec_box = QGroupBox("Security Level  (WriteReg 0x05)")
        sec_lay = QHBoxLayout(sec_box)
        sec_lay.addWidget(QLabel("1 = most permissive  …  5 = strictest:"))
        self.sec_spin = QSpinBox(); self.sec_spin.setRange(1, 5); self.sec_spin.setValue(3)
        sec_lay.addWidget(self.sec_spin)
        b = QPushButton("Write Security Level"); b.clicked.connect(self.cmd_set_security)
        sec_lay.addWidget(b); sec_lay.addStretch()
        lay.addWidget(sec_box)

        # Baud rate
        baud_box = QGroupBox("Baud Rate  (WriteReg 0x04)")
        baud_lay = QVBoxLayout(baud_box)
        baud_lay.addWidget(QLabel("Change persists after power cycle. Reconnect at new rate after writing."))
        baud_row = QHBoxLayout()
        self.baud_reg_cb = QComboBox()
        for item in ["1 — 9600", "2 — 19200", "4 — 38400", "6 — 57600", "12 — 115200"]:
            self.baud_reg_cb.addItem(item)
        self.baud_reg_cb.setCurrentText("6 — 57600"); self.baud_reg_cb.setMinimumWidth(140)
        baud_row.addWidget(self.baud_reg_cb)
        b = QPushButton("Write Baud Rate"); b.clicked.connect(self.cmd_set_baud)
        baud_row.addWidget(b); baud_row.addStretch()
        baud_lay.addLayout(baud_row)
        lay.addWidget(baud_box)

        # Packet size
        pkt_box = QGroupBox("Packet Size  (WriteReg 0x06)")
        pkt_lay = QHBoxLayout(pkt_box)
        self.pkt_cb = QComboBox()
        for item in ["0 — 32 bytes", "1 — 64 bytes", "2 — 128 bytes", "3 — 256 bytes"]:
            self.pkt_cb.addItem(item)
        self.pkt_cb.setCurrentText("2 — 128 bytes"); self.pkt_cb.setMinimumWidth(140)
        pkt_lay.addWidget(self.pkt_cb)
        b = QPushButton("Write Packet Size"); b.clicked.connect(self.cmd_set_packet_size)
        pkt_lay.addWidget(b); pkt_lay.addStretch()
        lay.addWidget(pkt_box)

        # Change password
        pwd_box = QGroupBox("Change Password  (PS_SetPwd 0x12)")
        pwd_lay = QVBoxLayout(pwd_box)
        pwd_warn = QLabel(
            "⚠  The factory default password is 00000000. "
            "Current password is verified against the module before any change is written.\n\n"
            "Note: password enforcement varies by module firmware — some variants accept all "
            "commands regardless of verification result, so changing the password may have no "
            "practical effect. Other variants will reject all commands until the correct password "
            "is sent, making the module difficult to recover if the password is forgotten.\n\n"
            "Leave untouched if unsure."
        )
        pwd_warn.setStyleSheet("color: #cc3300;"); pwd_warn.setWordWrap(True)
        pwd_lay.addWidget(pwd_warn)

        form = QGridLayout()
        form.setColumnMinimumWidth(0, 180)
        form.addWidget(QLabel("Current password (8 hex chars):"), 0, 0)
        self.pwd_current = QLineEdit("00000000")
        self.pwd_current.setMaxLength(8); self.pwd_current.setPlaceholderText("00000000")
        self.pwd_current.setMaximumWidth(130)
        form.addWidget(self.pwd_current, 0, 1)

        form.addWidget(QLabel("New password (8 hex chars):"), 1, 0)
        self.pwd_new = QLineEdit()
        self.pwd_new.setMaxLength(8); self.pwd_new.setPlaceholderText("00000000")
        self.pwd_new.setMaximumWidth(130)
        form.addWidget(self.pwd_new, 1, 1)

        form.addWidget(QLabel("Confirm new password:"), 2, 0)
        self.pwd_confirm = QLineEdit()
        self.pwd_confirm.setMaxLength(8); self.pwd_confirm.setPlaceholderText("00000000")
        self.pwd_confirm.setMaximumWidth(130)
        form.addWidget(self.pwd_confirm, 2, 1)
        pwd_lay.addLayout(form)

        b = QPushButton("Change Password")
        b.setMaximumWidth(160); b.clicked.connect(self.cmd_set_password)
        pwd_lay.addWidget(b)
        lay.addWidget(pwd_box)

        lay.addStretch()

    def _build_log(self):
        box = QGroupBox("Log")
        lay = QVBoxLayout(box)
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setFont(QFont("Consolas", 9))
        self.log.setStyleSheet("background: #1a1a2e; color: #00ff88;")
        self.log.setMinimumHeight(60)
        lay.addWidget(self.log)
        clr = QPushButton("Clear"); clr.setMaximumWidth(80)
        clr.clicked.connect(self.log.clear)
        lay.addWidget(clr, alignment=Qt.AlignmentFlag.AlignRight)
        return box

    # ── Connection ──────────────────────────────────────────────────────────────

    def _password_bytes(self) -> bytes:
        """Parse the connection bar password field into 4 bytes. Falls back to default."""
        try:
            b = bytes.fromhex(self.conn_password.text().strip().zfill(8))
            return b if len(b) == 4 else bytes(4)
        except ValueError:
            return bytes(4)

    # USB-serial adapter VIDs: CH340/CH341, CP210x, FTDI FT232, PL2303
    _SERIAL_VIDS = {0x1A86, 0x10C4, 0x0403, 0x067B}

    def refresh_ports(self):
        current = self.port_cb.currentText()
        self.port_cb.clear()
        ports = list(serial.tools.list_ports.comports())
        for p in ports:
            self.port_cb.addItem(p.device)

        # Restore previously selected port if it still exists
        if current:
            idx = self.port_cb.findText(current)
            if idx >= 0:
                self.port_cb.setCurrentIndex(idx)
                return

        # Auto-select: single port → pick it; multiple → prefer known USB-serial VIDs
        if len(ports) == 1:
            self.port_cb.setCurrentIndex(0)
        else:
            for p in ports:
                if p.vid in self._SERIAL_VIDS:
                    idx = self.port_cb.findText(p.device)
                    if idx >= 0:
                        self.port_cb.setCurrentIndex(idx)
                        break

    def toggle_connect(self):
        if self.ser and self.ser.is_open:
            self.ser.close()
            self.ser = None
            self.conn_btn.setText("Connect")
            self.conn_lbl.setText("● Disconnected")
            self.conn_lbl.setStyleSheet("color: red; font-weight: bold;")
            for lbl in (self.dev_status_lbl, self.dev_params_lbl, self.dev_count_lbl):
                lbl.setText("—"); lbl.setStyleSheet("")
            self.log_msg("Disconnected.")
        else:
            try:
                self.ser = serial.Serial(
                    self.port_cb.currentText(),
                    int(self.baud_cb.currentText()),
                    timeout=2, dsrdtr=False, rtscts=False,
                )
                self.ser.dtr = False
                self.ser.rts = False
                time.sleep(0.3)
                self.ser.reset_input_buffer()
                self.conn_btn.setText("Disconnect")
                self.conn_lbl.setText("● Connected")
                self.conn_lbl.setStyleSheet("color: green; font-weight: bold;")
                self.log_msg(f"Connected: {self.port_cb.currentText()} @ {self.baud_cb.currentText()}")
                self._auto_connect_query()
            except Exception as e:
                QMessageBox.critical(self, "Connection Error", str(e))

    # ── Auto-query on connect ───────────────────────────────────────────────────

    def _auto_connect_query(self):
        def _run():
            time.sleep(0.2)

            cc, _ = self.send_recv(FINGERPRINT_VERIFYPASSWORD, self._password_bytes())
            if cc == 0x00:
                self._ui(lambda: self.dev_status_lbl.setText("● OK"))
                self._ui(lambda: self.dev_status_lbl.setStyleSheet("color: green;"))
            elif cc is None:
                self._ui(lambda: self.dev_status_lbl.setText("⚠ No response"))
                self._ui(lambda: self.dev_status_lbl.setStyleSheet("color: #cc3300;"))
                return
            else:
                self._ui(lambda: self.dev_status_lbl.setText("⚠ Wrong password"))
                self._ui(lambda: self.dev_status_lbl.setStyleSheet("color: #cc3300;"))

            cc, data = self.send_recv(FINGERPRINT_READSYSPARAM)
            if cc == 0x00 and data and len(data) >= 16:
                capacity  = struct.unpack('>H', data[4:6])[0]
                sec_level = struct.unpack('>H', data[6:8])[0]
                pkt_idx   = struct.unpack('>H', data[12:14])[0]
                baud_n    = struct.unpack('>H', data[14:16])[0]
                pkt_map   = {0: 32, 1: 64, 2: 128, 3: 256}
                info = (f"cap={capacity}  sec={sec_level}  "
                        f"pkt={pkt_map.get(pkt_idx,'?')}B  baud={baud_n*9600}")
                self._ui(lambda i=info: self.dev_params_lbl.setText(i))
                self._ui(lambda i=info: self.sys_lbl.setText(i))

            cc, data = self.send_recv(FINGERPRINT_READ_INDEX, bytes([0x00]))
            if cc == 0x00 and data and len(data) >= 7:
                states = []
                for i in range(50):
                    byte_i, bit_i = divmod(i, 8)
                    states.append(bool(data[byte_i] & (1 << bit_i)))
                self._map_states = states
                enrolled = sum(states)
                self._ui(lambda e=enrolled: self.dev_count_lbl.setText(f"{e} enrolled"))
                self._ui(lambda s=states: self.map_widget.set_states(s))
            else:
                cc, data = self.send_recv(FINGERPRINT_TEMPLATECOUNT)
                if cc == 0x00 and data and len(data) >= 2:
                    count = struct.unpack('>H', data[:2])[0]
                    self._ui(lambda c=count: self.dev_count_lbl.setText(f"{c} enrolled"))

        threading.Thread(target=_run, daemon=True).start()

    # ── Core send/receive ───────────────────────────────────────────────────────

    def send_recv(self, ins, params=b'', timeout=3.0):
        if not (self.ser and self.ser.is_open):
            self.log_msg("ERROR: Not connected")
            return None, None

        pkt = build_packet(ins, params)
        self.log_msg(f"TX [0x{ins:02X}]: {pkt.hex(' ').upper()}")

        with self.lock:
            self.ser.reset_input_buffer()
            self.ser.write(pkt)
            self.ser.flush()

            buf      = bytearray()
            deadline = time.time() + timeout

            while len(buf) < 9 and time.time() < deadline:
                buf += self.ser.read(9 - len(buf))
            if len(buf) < 9:
                self.log_msg("TIMEOUT: no response header")
                return None, None

            length = struct.unpack('>H', buf[7:9])[0]
            total  = 9 + length
            while len(buf) < total and time.time() < deadline:
                buf += self.ser.read(total - len(buf))
            if len(buf) < total:
                self.log_msg(f"TIMEOUT: got {len(buf)}/{total} bytes")
                return None, None

        rx = bytes(buf)
        self.log_msg(f"RX ({len(rx)}B): {rx.hex(' ').upper()}")
        try:
            cc, data = parse_response(rx)
        except ValueError as e:
            self.log_msg(f"Parse error: {e}")
            return None, None

        self.log_msg(f"→ 0x{cc:02X}  {CONFIRM.get(cc, f'unknown 0x{cc:02X}')}")
        return cc, data

    def _recv_packets(self, timeout=5.0):
        """Read PID=0x02 data packets + PID=0x08 end packet; return assembled payload."""
        payload  = bytearray()
        deadline = time.time() + timeout
        while True:
            hdr = bytearray()
            while len(hdr) < 9 and time.time() < deadline:
                hdr += self.ser.read(max(1, 9 - len(hdr)))
            if len(hdr) < 9:
                self.log_msg("TIMEOUT reading data-stream header"); break
            if hdr[:2] != HEADER:
                self.log_msg(f"Bad header in data stream: {hdr[:2].hex().upper()}"); break
            pid    = hdr[6]
            length = struct.unpack('>H', hdr[7:9])[0]
            rest   = bytearray()
            while len(rest) < length and time.time() < deadline:
                rest += self.ser.read(max(1, length - len(rest)))
            if len(rest) < length:
                self.log_msg("TIMEOUT reading data-stream body"); break
            payload += rest[:-2]   # strip 2-byte checksum
            if pid == 0x08:        # end packet
                break
        return bytes(payload)

    def _send_packets(self, data, pkt_size=128):
        """Send data as PID=0x02 data packets + PID=0x08 end packet."""
        chunks = [data[i:i + pkt_size] for i in range(0, len(data), pkt_size)]
        for i, chunk in enumerate(chunks):
            pid = 0x08 if i == len(chunks) - 1 else 0x02
            lb  = struct.pack('>H', len(chunk) + 2)
            cs  = struct.pack('>H', fps_checksum(pid, lb, chunk))
            self.ser.write(HEADER + ADDR + bytes([pid]) + lb + chunk + cs)
        self.ser.flush()

    # ── Device commands ─────────────────────────────────────────────────────────

    def cmd_verify_password(self):
        cc, _ = self.send_recv(FINGERPRINT_VERIFYPASSWORD, self._password_bytes())
        if cc == 0x00:
            self.log_msg("Password OK — module is alive")
            self.dev_status_lbl.setText("● OK")
            self.dev_status_lbl.setStyleSheet("color: green;")
        elif cc == 0x13:
            self.log_msg("Wrong password")
            self.dev_status_lbl.setText("⚠ Wrong password")
            self.dev_status_lbl.setStyleSheet("color: #cc3300;")

    def cmd_read_sys_param(self):
        cc, data = self.send_recv(FINGERPRINT_READSYSPARAM)
        if cc == 0x00 and data and len(data) >= 16:
            capacity  = struct.unpack('>H', data[4:6])[0]
            sec_level = struct.unpack('>H', data[6:8])[0]
            pkt_idx   = struct.unpack('>H', data[12:14])[0]
            baud_n    = struct.unpack('>H', data[14:16])[0]
            pkt_map   = {0: 32, 1: 64, 2: 128, 3: 256}
            info = (f"cap={capacity}  sec={sec_level}  "
                    f"pkt={pkt_map.get(pkt_idx,'?')}B  baud={baud_n*9600}")
            self.log_msg(f"SysParam: {info}")
            self.sys_lbl.setText(info)
            self.dev_params_lbl.setText(info)

    def cmd_get_count(self):
        cc, data = self.send_recv(FINGERPRINT_TEMPLATECOUNT)
        if cc == 0x00 and data and len(data) >= 2:
            count = struct.unpack('>H', data[:2])[0]
            self.log_msg(f"Template count: {count}")
            self.dev_count_lbl.setText(f"{count} enrolled")

    def cmd_query_finger(self):
        cc, _ = self.send_recv(FINGERPRINT_GETIMAGE)
        if cc == 0x00:
            self.log_msg("Finger detected ✓")
        elif cc == 0x02:
            self.log_msg("No finger on sensor")

    def cmd_storage_map(self):
        cc, data = self.send_recv(FINGERPRINT_READ_INDEX, bytes([0x00]))
        if cc == 0x00 and data and len(data) >= 7:
            states = []
            for i in range(50):
                byte_i, bit_i = divmod(i, 8)
                states.append(bool(data[byte_i] & (1 << bit_i)))
            self._map_states = states
            self.map_widget.set_states(states)
            enrolled = [i for i, s in enumerate(states) if s]
            self.log_msg(f"Storage map: {len(enrolled)} enrolled — {enrolled}")
            self.dev_count_lbl.setText(f"{len(enrolled)} enrolled")
        else:
            self.log_msg("ReadIndex not supported; showing count only")
            self.cmd_get_count()

    # ── Enroll ──────────────────────────────────────────────────────────────────

    def cmd_enroll(self):
        fp_id = self.enroll_id.value()
        try:
            self.cmd_storage_map()
            free_idx = next((i for i, s in enumerate(self._map_states) if not s), None)
            if free_idx is None:
                QMessageBox.critical(self, "No Space", "No free fingerprint slots available.")
                return
            if self._map_states[fp_id]:
                fp_id = free_idx
                self.enroll_id.setValue(fp_id)
                self.log_msg(f"Using next available ID {fp_id}")
        except Exception as e:
            self.log_msg(f"Storage map check failed: {e}")

        self._enroll_cancel.clear()
        self.enroll_btn.setEnabled(False)
        self.enroll_prog.setValue(0)
        threading.Thread(target=self._enroll_worker, args=(fp_id,), daemon=True).start()

    def _enroll_worker(self, target_id):
        def status(msg):
            self.log_msg(f"[Enroll] {msg}")
            self._ui(lambda m=msg: self.enroll_lbl.setText(m))

        def progress(v):
            self._ui(lambda: self.enroll_prog.setValue(v))

        cancelled = self._enroll_cancel
        try:
            status("Scan 1/2: Place finger on sensor…")
            while not cancelled.is_set():
                cc, _ = self.send_recv(FINGERPRINT_GETIMAGE, timeout=0.8)
                if cc == 0x00: break
                if cc == 0x02: continue
                status(f"Image error: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
            if cancelled.is_set(): status("Cancelled"); return

            cc, _ = self.send_recv(FINGERPRINT_IMAGE2TZ, bytes([0x01]))
            if cc != 0x00:
                status(f"Feature extraction failed: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
            progress(2)

            status("Lift your finger…")
            while not cancelled.is_set():
                cc, _ = self.send_recv(FINGERPRINT_GETIMAGE, timeout=0.8)
                if cc == 0x02: break
            if cancelled.is_set(): status("Cancelled"); return
            time.sleep(0.3)
            progress(4)

            status("Scan 2/2: Place same finger on sensor again…")
            while not cancelled.is_set():
                cc, _ = self.send_recv(FINGERPRINT_GETIMAGE, timeout=0.8)
                if cc == 0x00: break
                if cc == 0x02: continue
                status(f"Image error: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
            if cancelled.is_set(): status("Cancelled"); return

            cc, _ = self.send_recv(FINGERPRINT_IMAGE2TZ, bytes([0x02]))
            if cc != 0x00:
                status(f"Feature extraction failed: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
            progress(6)

            status("Merging features…")
            cc, _ = self.send_recv(FINGERPRINT_REGMODEL)
            if cc == 0x0A:
                status("ERROR: Scans didn't match — use the same finger for both scans"); return
            if cc != 0x00:
                status(f"Model error: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
            progress(8)

            status(f"Storing as ID {target_id}…")
            cc, _ = self.send_recv(FINGERPRINT_STORE,
                                   bytes([0x01, (target_id >> 8) & 0xFF, target_id & 0xFF]))
            if cc == 0x00:
                status(f"✓ Enrolled successfully as ID {target_id}")
                progress(10)
                self._ui(self.cmd_storage_map)
            else:
                status(f"Store failed: {CONFIRM.get(cc, f'0x{cc:02X}')}")
        finally:
            self._ui(lambda: self.enroll_btn.setEnabled(True))

    def cmd_cancel_enroll(self):
        self._enroll_cancel.set()
        self.enroll_lbl.setText("Cancelling…")
        self.enroll_btn.setEnabled(True)

    # ── Verify ──────────────────────────────────────────────────────────────────

    def cmd_match(self):
        self.match_result.setText("Waiting…")
        self.match_result.setStyleSheet("color: gray; font-weight: bold; font-size: 14px;")
        self.match_detail.setText("Place finger on sensor")

        def set_result(text, color):
            self._ui(lambda t=text: self.match_result.setText(t))
            self._ui(lambda c=color: self.match_result.setStyleSheet(
                f"color: {c}; font-weight: bold; font-size: 14px;"))

        def _run():
            deadline = time.time() + self.match_timeout.value()

            while time.time() < deadline:
                cc, _ = self.send_recv(FINGERPRINT_GETIMAGE, timeout=0.8)
                if cc == 0x00: break
                if cc == 0x02: continue
                set_result(f"Error: {CONFIRM.get(cc, f'0x{cc:02X}')}", "red"); return
            else:
                set_result("Timeout — no finger", "orange")
                self._ui(lambda: self.match_detail.setText("")); return

            cc, _ = self.send_recv(FINGERPRINT_IMAGE2TZ, bytes([0x01]))
            if cc != 0x00:
                set_result(f"Feature error: {CONFIRM.get(cc, f'0x{cc:02X}')}", "red"); return

            cc, data = self.send_recv(FINGERPRINT_HISPEEDSEARCH,
                                      bytes([0x01, 0x00, 0x00, 0x00, 0xA3]))
            if cc == 0x00 and (not data or len(data) < 4):
                self.log_msg("HISPEEDSEARCH no payload — trying SEARCH fallback")
                cc, data = self.send_recv(FINGERPRINT_SEARCH,
                                          bytes([0x01, 0x00, 0x00, 0x00, 0xA3]))

            if cc == 0x00 and data and len(data) >= 4:
                fp_id = struct.unpack('>H', data[0:2])[0]
                score = struct.unpack('>H', data[2:4])[0]
                set_result(f"MATCH — ID {fp_id}", "#00aa00")
                self._ui(lambda s=score: self.match_detail.setText(f"Confidence: {s}"))
                self.log_msg(f"MATCHED ID={fp_id}  confidence={score}")
            elif cc in (0x09, 0x00):
                set_result("NO MATCH", "red")
                self._ui(lambda: self.match_detail.setText(""))
            elif cc == 0x1E:
                set_result("Library is empty", "red")
                self._ui(lambda: self.match_detail.setText(""))
            else:
                msg = CONFIRM.get(cc, f"0x{cc:02X}") if cc is not None else "comm error"
                set_result(f"Error: {msg}", "red")

        threading.Thread(target=_run, daemon=True).start()

    # ── Manage ──────────────────────────────────────────────────────────────────

    def cmd_check_exists(self):
        fp_id = self.chk_id.value()
        cc, _ = self.send_recv(FINGERPRINT_LOAD,
                               bytes([0x01, (fp_id >> 8) & 0xFF, fp_id & 0xFF]))
        if cc == 0x00:   self.log_msg(f"ID {fp_id}: EXISTS")
        elif cc == 0x0C: self.log_msg(f"ID {fp_id}: NOT FOUND")
        else:            self.log_msg(f"ID {fp_id}: {CONFIRM.get(cc, f'0x{cc:02X}')}")

    def cmd_delete_single(self):
        fp_id = self.del_id.value()
        if QMessageBox.question(self, "Confirm", f"Delete fingerprint ID {fp_id}?") != QMessageBox.StandardButton.Yes:
            return
        cc, _ = self.send_recv(FINGERPRINT_DELETE,
                               bytes([(fp_id >> 8) & 0xFF, fp_id & 0xFF, 0x00, 0x01]))
        if cc == 0x00:
            self.log_msg(f"ID {fp_id} deleted")
            self.cmd_storage_map()

    def cmd_delete_range(self):
        first, last = self.del_first.value(), self.del_last.value()
        if QMessageBox.question(self, "Confirm", f"Delete IDs {first}–{last}?") != QMessageBox.StandardButton.Yes:
            return
        count = last - first + 1
        cc, _ = self.send_recv(FINGERPRINT_DELETE,
                               bytes([(first >> 8) & 0xFF, first & 0xFF,
                                      (count >> 8) & 0xFF, count & 0xFF]))
        if cc == 0x00:
            self.log_msg(f"Deleted IDs {first}–{last}")
            self.cmd_storage_map()

    def cmd_delete_all(self):
        if QMessageBox.question(self, "WIPE ALL",
                                "Permanently delete ALL fingerprints?\n\nThis cannot be undone!"
                                ) != QMessageBox.StandardButton.Yes:
            return
        cc, _ = self.send_recv(FINGERPRINT_EMPTY)
        if cc == 0x00:
            self.log_msg("ALL fingerprints wiped.")
            self.cmd_storage_map()

    def cmd_export(self):
        if not (self.ser and self.ser.is_open):
            self.log_msg("ERROR: Not connected"); return
        fp_id = self.export_id_spin.value()

        # Load slot into CharBuffer1
        cc, _ = self.send_recv(FINGERPRINT_LOAD,
                               bytes([0x01, (fp_id >> 8) & 0xFF, fp_id & 0xFF]))
        if cc != 0x00:
            self.log_msg(f"[Export] Load ID {fp_id}: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return

        # UpChar: request the buffer as a data stream
        pkt = build_packet(FINGERPRINT_UPCHAR, bytes([0x01]))
        self.log_msg(f"TX [0x08 UpChar]: {pkt.hex(' ').upper()}")
        template_data = None
        with self.lock:
            try:
                self.ser.reset_input_buffer()
                self.ser.write(pkt); self.ser.flush()
                buf = bytearray()
                deadline = time.time() + 3.0
                while len(buf) < 9 and time.time() < deadline:
                    buf += self.ser.read(max(1, 9 - len(buf)))
                if len(buf) < 9:
                    self.log_msg("[Export] Timeout: no UpChar ACK"); return
                length = struct.unpack('>H', buf[7:9])[0]
                total  = 9 + length
                while len(buf) < total and time.time() < deadline:
                    buf += self.ser.read(max(1, total - len(buf)))
                cc, _ = parse_response(bytes(buf))
                self.log_msg(f"RX UpChar ACK: 0x{cc:02X}  {CONFIRM.get(cc, '')}")
                if cc != 0x00:
                    self.log_msg(f"[Export] UpChar rejected: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
                template_data = self._recv_packets()
            except Exception as e:
                self.log_msg(f"[Export] Error: {e}"); return

        if not template_data:
            self.log_msg("[Export] No data received"); return
        self.log_msg(f"[Export] Received {len(template_data)} bytes")

        path, _ = QFileDialog.getSaveFileName(
            self, f"Export Fingerprint — ID {fp_id}",
            f"fingerprint_id{fp_id:02d}.fp",
            "Fingerprint Template (*.fp);;All Files (*)"
        )
        if not path:
            return
        with open(path, 'wb') as f:
            f.write(b'HLK\x01')
            f.write(struct.pack('>H', fp_id))
            f.write(struct.pack('>H', len(template_data)))
            f.write(template_data)
        self.log_msg(f"[Export] ID {fp_id} saved to {path}")

    def cmd_import(self):
        if not (self.ser and self.ser.is_open):
            self.log_msg("ERROR: Not connected"); return

        path, _ = QFileDialog.getOpenFileName(
            self, "Import Fingerprint Template",
            "", "Fingerprint Template (*.fp);;All Files (*)"
        )
        if not path:
            return
        try:
            with open(path, 'rb') as f:
                if f.read(3) != b'HLK':
                    QMessageBox.critical(self, "Invalid File", "Not a valid .fp template file."); return
                f.read(1)  # version
                orig_id       = struct.unpack('>H', f.read(2))[0]
                datalen       = struct.unpack('>H', f.read(2))[0]
                if datalen > 1024:
                    QMessageBox.critical(self, "Invalid File",
                                         f"Template data too large ({datalen} bytes). Max expected is 1024."); return
                template_data = f.read(datalen)
                if len(template_data) != datalen:
                    QMessageBox.critical(self, "Invalid File",
                                         f"File is truncated: expected {datalen} bytes, got {len(template_data)}."); return
        except Exception as e:
            QMessageBox.critical(self, "Read Error", str(e)); return

        target_id = self.import_id_spin.value()
        self.log_msg(f"[Import] {len(template_data)}B (orig slot {orig_id}) → slot {target_id}")

        # DownChar: send the template as a data stream
        pkt = build_packet(FINGERPRINT_DOWNCHAR, bytes([0x01]))
        self.log_msg(f"TX [0x09 DownChar]: {pkt.hex(' ').upper()}")
        with self.lock:
            try:
                self.ser.reset_input_buffer()
                self.ser.write(pkt); self.ser.flush()
                buf = bytearray()
                deadline = time.time() + 3.0
                while len(buf) < 9 and time.time() < deadline:
                    buf += self.ser.read(max(1, 9 - len(buf)))
                if len(buf) < 9:
                    self.log_msg("[Import] Timeout: no DownChar ACK"); return
                length = struct.unpack('>H', buf[7:9])[0]
                total  = 9 + length
                while len(buf) < total and time.time() < deadline:
                    buf += self.ser.read(max(1, total - len(buf)))
                cc, _ = parse_response(bytes(buf))
                self.log_msg(f"RX DownChar ACK: 0x{cc:02X}  {CONFIRM.get(cc, '')}")
                if cc != 0x00:
                    self.log_msg(f"[Import] DownChar rejected: {CONFIRM.get(cc, f'0x{cc:02X}')}"); return
                self._send_packets(template_data)
            except Exception as e:
                self.log_msg(f"[Import] Error: {e}"); return

        # Store CharBuffer1 to the target slot
        cc, _ = self.send_recv(FINGERPRINT_STORE,
                               bytes([0x01, (target_id >> 8) & 0xFF, target_id & 0xFF]))
        if cc == 0x00:
            self.log_msg(f"[Import] Stored to slot {target_id} ✓")
            self.cmd_storage_map()
        else:
            self.log_msg(f"[Import] Store failed: {CONFIRM.get(cc, f'0x{cc:02X}')}")

    # ── LED ─────────────────────────────────────────────────────────────────────

    _CMAP = {1: 0x04, 2: 0x01, 3: 0x05, 4: 0x02, 5: 0x03, 6: 0x06, 7: 0x07, 0: 0x00}

    def _led_color_mask(self):
        try:
            return self._CMAP.get(int(self.led_color_cb.currentText().split()[0]), 0x00)
        except Exception:
            return 0x01

    def _led_cycles(self):
        return self.led_cycles_spin.value()

    def _led_send(self, func, start, end, cycles, label):
        cc, _ = self.send_recv(FINGERPRINT_AURALEDCONFIG, bytes([func, start, end, cycles]))
        if cc == 0x00:
            self.log_msg(f"LED → {label}")

    def cmd_led_breathing(self):
        m = self._led_color_mask()
        self._led_send(1, m, m, self._led_cycles(), f"Breathing (cycles={self._led_cycles()})")

    def cmd_led_flash(self):
        m = self._led_color_mask()
        self._led_send(2, m, m, self._led_cycles(), f"Flash (cycles={self._led_cycles()})")

    def cmd_led_steady(self):
        m = self._led_color_mask()
        self._led_send(3, m, m, 0, "Steady On")

    def cmd_led_grad_open(self):
        m = self._led_color_mask()
        self._led_send(5, m, m, 0, "Gradually Open")

    def cmd_led_grad_close(self):
        m = self._led_color_mask()
        self._led_send(6, m, m, 0, "Gradually Close")

    def cmd_led_off_simple(self):
        self._led_send(4, 0x00, 0x00, 0, "Off")

    # ── Settings ────────────────────────────────────────────────────────────────

    def cmd_set_password(self):
        current_str = self.pwd_current.text().strip().zfill(8)
        new_str     = self.pwd_new.text().strip().zfill(8)
        confirm_str = self.pwd_confirm.text().strip().zfill(8)

        try:
            current_bytes = bytes.fromhex(current_str)
            new_bytes     = bytes.fromhex(new_str)
            confirm_bytes = bytes.fromhex(confirm_str)
        except ValueError:
            QMessageBox.critical(self, "Invalid Input",
                                 "Passwords must be 8 hex characters (e.g. 00000000).")
            return

        if len(new_bytes) != 4 or len(confirm_bytes) != 4:
            QMessageBox.critical(self, "Invalid Input",
                                 "Each password field must be exactly 4 bytes (8 hex chars).")
            return

        if new_bytes != confirm_bytes:
            QMessageBox.critical(self, "Mismatch",
                                 "New password and confirmation do not match.")
            return

        # Verify current password against module before writing new one
        cc, _ = self.send_recv(FINGERPRINT_VERIFYPASSWORD, current_bytes)
        if cc != 0x00:
            QMessageBox.critical(self, "Wrong Password",
                                 "Current password verification failed. No changes were made.\n\n"
                                 "Make sure the password in the Connection bar matches what's on the module.")
            return

        reply = QMessageBox.warning(
            self, "Confirm Password Change",
            f"New password will be set to:  {new_str.upper()}\n\n"
            "Note: whether this has any effect depends on your module firmware.\n"
            "Some variants do not enforce password gating.\n\n"
            "Proceed?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No,
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        cc, _ = self.send_recv(FINGERPRINT_SETPASSWORD, new_bytes)
        if cc == 0x00:
            self.log_msg(f"Password changed to {new_str.upper()}")
            self.pwd_current.setText(new_str)
            self.conn_password.setText(new_str)   # keep connection bar in sync
            self.pwd_new.clear()
            self.pwd_confirm.clear()
            QMessageBox.information(self, "Success",
                                    f"Password changed to {new_str.upper()}.\n"
                                    "The Connection bar password has been updated automatically.")
        else:
            self.log_msg(f"Password change failed: {CONFIRM.get(cc, f'0x{cc:02X}')}")
            QMessageBox.critical(self, "Failed",
                                 f"Password change failed: {CONFIRM.get(cc, f'0x{cc:02X}')}")

    def cmd_set_security(self):
        cc, _ = self.send_recv(FINGERPRINT_WRITE_REG, bytes([0x05, self.sec_spin.value()]))
        if cc == 0x00:
            self.log_msg(f"Security level → {self.sec_spin.value()}")

    def cmd_set_baud(self):
        try:
            n = int(self.baud_reg_cb.currentText().split()[0])
        except (ValueError, IndexError):
            return
        cc, _ = self.send_recv(FINGERPRINT_WRITE_REG, bytes([0x04, n]))
        if cc == 0x00:
            self.log_msg(f"Baud rate → {n * 9600}  (reconnect at new rate)")

    def cmd_set_packet_size(self):
        try:
            idx = int(self.pkt_cb.currentText().split()[0])
        except (ValueError, IndexError):
            return
        cc, _ = self.send_recv(FINGERPRINT_WRITE_REG, bytes([0x06, idx]))
        if cc == 0x00:
            sizes = {0: 32, 1: 64, 2: 128, 3: 256}
            self.log_msg(f"Packet size → {sizes.get(idx, '?')}B")

    # ── Log ─────────────────────────────────────────────────────────────────────

    def log_msg(self, msg):
        line = f"[{time.strftime('%H:%M:%S')}] {msg}"
        self._ui(lambda l=line: self.log.appendPlainText(l))


# ── Entry point ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setWindowIcon(QIcon(_ICON))
    apply_theme(app, "system")
    bg       = app.palette().color(QPalette.ColorRole.Window)
    detected = "dark" if bg.lightness() < 128 else "light"
    saved    = QSettings("GavinnnTann", "HLK-ZW101-Tester").value("theme", "")
    startup_theme = saved if saved in ("dark", "light", "system") else detected
    apply_theme(app, startup_theme)
    win = App()
    win.theme_cb.blockSignals(True)
    win.theme_cb.setCurrentText(startup_theme.capitalize())
    win.theme_cb.blockSignals(False)
    win.show()
    sys.exit(app.exec())
