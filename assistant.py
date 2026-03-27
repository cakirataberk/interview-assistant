import json
import os
import queue
import threading
import time
import wave
from datetime import datetime
from pathlib import Path
import tkinter as tk
from tkinter import messagebox, scrolledtext, ttk

import google.generativeai as genai
import pyaudio
import speech_recognition as sr


CONFIG_DIR = Path.home() / ".interview_assistant"
CONFIG_FILE = CONFIG_DIR / "config.json"
DEFAULT_ALPHA = 0.96
TELEPROMPTER_ALPHA = 0.55
MIN_ALPHA = 0.30
MAX_ALPHA = 1.00

app_queue = queue.Queue()


def get_ai_suggestion(user_question, system_prompt, api_key, conversation_history=None):
    """Send prompts to Gemini with optional conversation history."""
    try:
        genai.configure(api_key=api_key)
        try:
            model = genai.GenerativeModel(
                "gemini-3-flash-preview",
                system_instruction=system_prompt,
            )
        except Exception:
            try:
                model = genai.GenerativeModel(
                    "gemini-2.5-flash",
                    system_instruction=system_prompt,
                )
            except Exception:
                model = genai.GenerativeModel(
                    "gemini-2.5-flash-lite",
                    system_instruction=system_prompt,
                )

        if conversation_history:
            history_text = "\n\n--- Previous Conversation ---\n"
            for i, (q_text, a_text) in enumerate(conversation_history[-5:], 1):
                history_text += f"\nQ{i}: {q_text}\nA{i}: {a_text}\n"
            history_text += "\n--- Current Question ---\n"
            full_question = history_text + user_question
        else:
            full_question = user_question

        response = model.generate_content(full_question)
        return response.text
    except Exception as err:
        return f"An error occurred with the AI: {err}"


class AssistantApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Interview Assistant")
        self.root.geometry("980x860")
        self.root.minsize(860, 700)

        self._setup_theme()
        self.root.configure(bg=self.BG_COLOR)

        self.is_closing = False
        self.is_teleprompter_mode = False
        self.status_text = tk.StringVar(value="Ready")
        self.connection_text = tk.StringVar(value="AI: Not Configured")
        self.device_text = tk.StringVar(value="Device: Detecting...")
        self.capture_text = tk.StringVar(value="Capture: idle")
        self.recording_duration_text = tk.StringVar(value="Recording: 00:00")
        self.alpha_percent_var = tk.IntVar(value=int(DEFAULT_ALPHA * 100))
        self.alpha_value = DEFAULT_ALPHA
        self.saved_alpha_before_teleprompter = self.alpha_value
        self.api_key_var = tk.StringVar()
        self.show_api_key = False
        self.api_key_entry = None
        self.record_start_time = None
        self.listening_source = None
        self.last_transcription_time = None

        self.conversation_history = []
        self.max_history = 5

        self.recognizer = sr.Recognizer()
        self.recognizer.pause_threshold = 0.5
        self.recognizer.dynamic_energy_threshold = True
        self.recognizer.energy_threshold = 4000
        self.recognizer.operation_timeout = None
        self.stop_listening = None

        self.available_microphones = []
        self.microphone_device_index = self.find_microphone_device()
        self.device_text.set(f"Device: {self.get_device_name(self.microphone_device_index)}")

        self.is_recording = False
        self.recording_thread = None
        self.audio_stream = None
        self.pyaudio_instance = None
        self.recording_file = None

        self.load_config()
        self.apply_alpha(self.alpha_value)

        self._build_layout()

        self.root.protocol("WM_DELETE_WINDOW", self.on_closing)
        self.root.after(100, self.check_queue)
        self.root.after(1000, self.update_recording_duration)

    def _setup_theme(self):
        self.style = ttk.Style(self.root)
        self.style.theme_use("clam")

        self.BG_COLOR = "#13151A"
        self.CARD_COLOR = "#1B1F2A"
        self.BORDER_COLOR = "#2A3040"
        self.TEXT_COLOR = "#EEF2FF"
        self.TEXT_SECONDARY = "#A5B0CC"
        self.BUTTON_COLOR = "#272E40"
        self.BUTTON_HOVER = "#333D55"
        self.ACCENT_COLOR = "#6366F1"
        self.ACCENT_HOVER = "#7C82FF"
        self.SUCCESS_COLOR = "#10B981"
        self.DANGER_COLOR = "#EF4444"
        self.TEXT_AREA_BG = "#111621"

        self.style.configure(
            ".",
            background=self.BG_COLOR,
            foreground=self.TEXT_COLOR,
            font=("SF Pro Display", 12),
        )
        self.style.configure("TFrame", background=self.BG_COLOR)
        self.style.configure("TLabel", background=self.BG_COLOR, foreground=self.TEXT_COLOR)
        self.style.configure("TNotebook", background=self.BG_COLOR, borderwidth=0)
        self.style.configure(
            "TNotebook.Tab",
            background=self.CARD_COLOR,
            foreground=self.TEXT_SECONDARY,
            padding=[18, 10],
            font=("SF Pro Display", 12, "bold"),
            borderwidth=0,
        )
        self.style.map(
            "TNotebook.Tab",
            background=[("selected", self.BG_COLOR)],
            foreground=[("selected", self.TEXT_COLOR)],
        )
        self.style.configure(
            "Rounded.TButton",
            background=self.BUTTON_COLOR,
            foreground=self.TEXT_COLOR,
            borderwidth=1,
            relief="flat",
            padding=[14, 9],
            focusthickness=0,
            focuscolor=self.BUTTON_COLOR,
            font=("SF Pro Display", 11, "bold"),
        )
        self.style.map(
            "Rounded.TButton",
            background=[("active", self.BUTTON_HOVER), ("pressed", self.ACCENT_COLOR)],
            bordercolor=[("active", self.ACCENT_COLOR)],
        )
        self.style.configure("Accent.TButton", background=self.ACCENT_COLOR, foreground=self.TEXT_COLOR)
        self.style.map("Accent.TButton", background=[("active", self.ACCENT_HOVER), ("pressed", self.ACCENT_HOVER)])
        self.style.configure("Danger.TButton", background="#7F1D1D", foreground=self.TEXT_COLOR)
        self.style.map("Danger.TButton", background=[("active", "#991B1B"), ("pressed", "#B91C1C")])
        self.style.configure("Card.TLabelframe", background=self.CARD_COLOR, bordercolor=self.BORDER_COLOR, borderwidth=1)
        self.style.configure(
            "Card.TLabelframe.Label",
            background=self.CARD_COLOR,
            foreground=self.TEXT_SECONDARY,
            font=("SF Pro Display", 10, "bold"),
        )
        self.style.configure("Status.TLabel", background=self.CARD_COLOR, foreground=self.TEXT_SECONDARY, font=("SF Pro Text", 10))

    def _build_layout(self):
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(padx=14, pady=(14, 8), fill="both", expand=True)

        self.assistant_tab = ttk.Frame(self.notebook, style="TFrame")
        self.setup_tab = ttk.Frame(self.notebook, style="TFrame")
        self.notebook.add(self.assistant_tab, text="Assistant")
        self.notebook.add(self.setup_tab, text="Setup")

        self.create_assistant_tab()
        self.create_setup_tab()
        self.create_status_bar()
        self.update_history_label()
        self.update_connection_state()

    def create_status_bar(self):
        status_bar = tk.Frame(self.root, bg=self.CARD_COLOR, highlightthickness=1, highlightbackground=self.BORDER_COLOR)
        status_bar.pack(side=tk.BOTTOM, fill="x", padx=12, pady=(0, 10))
        ttk.Label(status_bar, textvariable=self.status_text, style="Status.TLabel").pack(side=tk.LEFT, padx=12, pady=6)
        ttk.Label(status_bar, text="|", style="Status.TLabel").pack(side=tk.LEFT)
        ttk.Label(status_bar, textvariable=self.connection_text, style="Status.TLabel").pack(side=tk.LEFT, padx=8)
        ttk.Label(status_bar, text="|", style="Status.TLabel").pack(side=tk.LEFT)
        ttk.Label(status_bar, textvariable=self.device_text, style="Status.TLabel").pack(side=tk.LEFT, padx=8)
        ttk.Label(status_bar, text="|", style="Status.TLabel").pack(side=tk.LEFT)
        ttk.Label(status_bar, textvariable=self.capture_text, style="Status.TLabel").pack(side=tk.LEFT, padx=8)
        ttk.Label(status_bar, text="|", style="Status.TLabel").pack(side=tk.LEFT)
        ttk.Label(status_bar, textvariable=self.recording_duration_text, style="Status.TLabel").pack(side=tk.LEFT, padx=8)

    def create_assistant_tab(self):
        top_frame = tk.Frame(self.assistant_tab, bg=self.BG_COLOR)
        top_frame.pack(fill="x", padx=12, pady=(10, 8))

        indicator_wrap = tk.Frame(top_frame, bg=self.BG_COLOR)
        indicator_wrap.pack(side=tk.LEFT)
        self.listening_indicator = tk.Canvas(indicator_wrap, width=22, height=22, bg=self.BG_COLOR, highlightthickness=0)
        self.listening_indicator.pack(side=tk.LEFT, padx=(0, 8))
        self.indicator_light = self.listening_indicator.create_oval(4, 4, 18, 18, fill=self.DANGER_COLOR, outline="")
        self.indicator_ring = self.listening_indicator.create_oval(2, 2, 20, 20, outline="", width=0)

        self.status_label = ttk.Label(top_frame, text="Status: Paused", font=("SF Pro Display", 12))
        self.status_label.pack(side=tk.LEFT)

        history_badge = tk.Frame(top_frame, bg=self.CARD_COLOR, highlightthickness=1, highlightbackground=self.BORDER_COLOR)
        history_badge.pack(side=tk.RIGHT)
        self.history_label = ttk.Label(history_badge, text="History: 0/5", background=self.CARD_COLOR, foreground=self.TEXT_SECONDARY)
        self.history_label.pack(padx=10, pady=4)

        listening_card = ttk.LabelFrame(self.assistant_tab, text="Listening", style="Card.TLabelframe")
        listening_card.pack(fill="x", padx=12, pady=(4, 8))
        listening_body = tk.Frame(listening_card, bg=self.CARD_COLOR)
        listening_body.pack(fill="x", padx=10, pady=10)
        self.toggle_button = ttk.Button(listening_body, text="Start Listening", command=self.toggle_listening, style="Rounded.TButton")
        self.toggle_button.pack(side=tk.LEFT, padx=(0, 8))
        self.clear_button = ttk.Button(listening_body, text="Clear Text", command=self.clear_text, style="Rounded.TButton")
        self.clear_button.pack(side=tk.LEFT, padx=8)
        self.clear_history_button = ttk.Button(listening_body, text="Clear History", command=self.clear_history, style="Rounded.TButton")
        self.clear_history_button.pack(side=tk.LEFT, padx=8)
        self.teleprompter_button = ttk.Button(
            listening_body,
            text="Teleprompter Mode: Off",
            command=self.toggle_teleprompter_mode,
            style="Rounded.TButton",
        )
        self.teleprompter_button.pack(side=tk.LEFT, padx=8)

        recording_card = ttk.LabelFrame(self.assistant_tab, text="Recording", style="Card.TLabelframe")
        recording_card.pack(fill="x", padx=12, pady=(4, 8))
        recording_body = tk.Frame(recording_card, bg=self.CARD_COLOR)
        recording_body.pack(fill="x", padx=10, pady=10)
        self.record_button = ttk.Button(recording_body, text="Start Recording", command=self.toggle_recording, style="Danger.TButton")
        self.record_button.pack(side=tk.LEFT)
        self.recording_status_label = ttk.Label(recording_body, text="", background=self.CARD_COLOR, foreground=self.TEXT_SECONDARY)
        self.recording_status_label.pack(side=tk.LEFT, padx=10)

        question_card = ttk.LabelFrame(self.assistant_tab, text="Question (Editable)", style="Card.TLabelframe")
        question_card.pack(fill="both", expand=True, padx=12, pady=(4, 8))
        self.question_text = scrolledtext.ScrolledText(
            question_card,
            height=6,
            font=("SF Mono", 13),
            bg=self.TEXT_AREA_BG,
            fg=self.TEXT_COLOR,
            relief="flat",
            borderwidth=0,
            padx=12,
            pady=10,
            insertbackground=self.ACCENT_COLOR,
            selectbackground=self.ACCENT_COLOR,
            wrap=tk.WORD,
        )
        self.question_text.pack(fill="both", expand=True, padx=10, pady=10)

        response_card = ttk.LabelFrame(self.assistant_tab, text="AI Response", style="Card.TLabelframe")
        response_card.pack(fill="both", expand=True, padx=12, pady=(4, 10))
        response_controls = tk.Frame(response_card, bg=self.CARD_COLOR)
        response_controls.pack(fill="x", padx=10, pady=(10, 6))
        self.get_suggestion_button = ttk.Button(
            response_controls, text="Get AI Suggestion", command=self.fetch_suggestion, style="Accent.TButton"
        )
        self.get_suggestion_button.pack(side=tk.LEFT)
        self.suggestion_text = scrolledtext.ScrolledText(
            response_card,
            height=10,
            state="disabled",
            font=("SF Mono", 17),
            bg=self.TEXT_AREA_BG,
            fg=self.TEXT_COLOR,
            wrap=tk.WORD,
            relief="flat",
            borderwidth=0,
            padx=12,
            pady=10,
            selectbackground=self.ACCENT_COLOR,
        )
        self.suggestion_text.pack(fill="both", expand=True, padx=10, pady=(0, 10))

    def create_setup_tab(self):
        container = tk.Frame(self.setup_tab, bg=self.BG_COLOR)
        container.pack(fill="both", expand=True, padx=12, pady=10)

        canvas = tk.Canvas(container, bg=self.BG_COLOR, highlightthickness=0)
        scrollbar = ttk.Scrollbar(container, orient="vertical", command=canvas.yview)
        scrollable = tk.Frame(canvas, bg=self.BG_COLOR)

        def _set_scroll_region(_evt=None):
            canvas.configure(scrollregion=canvas.bbox("all"))

        def _set_width(evt):
            canvas.itemconfig(canvas_window, width=evt.width)

        scrollable.bind("<Configure>", _set_scroll_region)
        canvas_window = canvas.create_window((0, 0), window=scrollable, anchor="nw")
        canvas.bind("<Configure>", _set_width)
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        api_card = ttk.LabelFrame(scrollable, text="API & Window", style="Card.TLabelframe")
        api_card.pack(fill="x", pady=(0, 10))
        api_body = tk.Frame(api_card, bg=self.CARD_COLOR)
        api_body.pack(fill="x", padx=10, pady=10)

        ttk.Label(api_body, text="Gemini API Key", background=self.CARD_COLOR).grid(row=0, column=0, sticky="w")
        self.api_key_entry = ttk.Entry(api_body, textvariable=self.api_key_var, show="*", width=58)
        self.api_key_entry.grid(row=1, column=0, sticky="we", padx=(0, 8), pady=(4, 0))
        ttk.Button(api_body, text="Show", command=self.toggle_api_visibility, style="Rounded.TButton").grid(
            row=1, column=1, padx=4, pady=(4, 0)
        )
        ttk.Button(api_body, text="Save", command=self.save_api_key, style="Rounded.TButton").grid(
            row=1, column=2, padx=4, pady=(4, 0)
        )

        ttk.Label(api_body, text="Window Opacity", background=self.CARD_COLOR).grid(row=2, column=0, sticky="w", pady=(12, 0))
        opacity_row = tk.Frame(api_body, bg=self.CARD_COLOR)
        opacity_row.grid(row=3, column=0, columnspan=3, sticky="we", pady=(4, 0))
        self.opacity_scale = ttk.Scale(
            opacity_row,
            from_=int(MIN_ALPHA * 100),
            to=int(MAX_ALPHA * 100),
            orient=tk.HORIZONTAL,
            variable=self.alpha_percent_var,
            command=self.on_opacity_slider,
        )
        self.opacity_scale.pack(side=tk.LEFT, fill="x", expand=True, padx=(0, 8))
        self.opacity_label = ttk.Label(opacity_row, text=f"{self.alpha_percent_var.get()}%", background=self.CARD_COLOR)
        self.opacity_label.pack(side=tk.LEFT)

        ttk.Label(api_body, text="Audio Input Device", background=self.CARD_COLOR).grid(row=4, column=0, sticky="w", pady=(12, 0))
        device_row = tk.Frame(api_body, bg=self.CARD_COLOR)
        device_row.grid(row=5, column=0, columnspan=3, sticky="we", pady=(4, 0))
        self.device_var = tk.StringVar(value="")
        self.device_combo = ttk.Combobox(device_row, textvariable=self.device_var, state="readonly", width=52)
        self.device_combo.pack(side=tk.LEFT, fill="x", expand=True, padx=(0, 8))
        ttk.Button(device_row, text="Refresh", command=self.refresh_microphone_list, style="Rounded.TButton").pack(side=tk.LEFT, padx=4)
        ttk.Button(device_row, text="Use Selected", command=self.apply_selected_microphone, style="Rounded.TButton").pack(side=tk.LEFT, padx=4)
        api_body.columnconfigure(0, weight=1)

        cv_card = ttk.LabelFrame(scrollable, text="CV", style="Card.TLabelframe")
        cv_card.pack(fill="both", expand=True, pady=(0, 10))
        self.cv_text = scrolledtext.ScrolledText(
            cv_card,
            height=8,
            font=("SF Mono", 12),
            bg=self.TEXT_AREA_BG,
            fg=self.TEXT_COLOR,
            relief="flat",
            borderwidth=0,
            padx=12,
            pady=10,
            insertbackground=self.ACCENT_COLOR,
            wrap=tk.WORD,
        )
        self.cv_text.pack(fill="both", expand=True, padx=10, pady=10)
        try:
            with open("cv.txt", "r", encoding="utf-8") as file:
                self.cv_text.insert(tk.END, file.read())
        except FileNotFoundError:
            pass

        jd_card = ttk.LabelFrame(scrollable, text="Job Description", style="Card.TLabelframe")
        jd_card.pack(fill="both", expand=True, pady=(0, 10))
        self.jd_text = scrolledtext.ScrolledText(
            jd_card,
            height=8,
            font=("SF Mono", 12),
            bg=self.TEXT_AREA_BG,
            fg=self.TEXT_COLOR,
            relief="flat",
            borderwidth=0,
            padx=12,
            pady=10,
            insertbackground=self.ACCENT_COLOR,
            wrap=tk.WORD,
        )
        self.jd_text.pack(fill="both", expand=True, padx=10, pady=10)
        try:
            with open("job_description.txt", "r", encoding="utf-8") as file:
                self.jd_text.insert(tk.END, file.read())
        except FileNotFoundError:
            pass

        prompt_card = ttk.LabelFrame(scrollable, text="System Prompt (AI Instructions)", style="Card.TLabelframe")
        prompt_card.pack(fill="both", expand=True, pady=(0, 10))
        self.system_prompt_text = scrolledtext.ScrolledText(
            prompt_card,
            height=10,
            font=("SF Mono", 12),
            bg=self.TEXT_AREA_BG,
            fg=self.TEXT_COLOR,
            relief="flat",
            borderwidth=0,
            padx=12,
            pady=10,
            insertbackground=self.ACCENT_COLOR,
            wrap=tk.WORD,
        )
        self.system_prompt_text.pack(fill="both", expand=True, padx=10, pady=10)

        default_system_prompt = """
You are my interview coach. I'm in a live job interview right now.

Goal: Give me ready-to-speak answers I can say out loud or paraphrase naturally.

Rules:
- 3–5 sentences max. No filler, no preamble.
- Bullet points only when listing 2+ items.
- Sound confident and conversational — not robotic or overly formal.
- Start answers directly. Never say "Great question" or similar.
- If the question is behavioral (e.g. "Tell me about a time..."), use a tight STAR format (Situation → Action → Result, skip the Task label).
- If technical, be precise and concise. Show depth in few words.

My background:
--- {cv} ---

Role I'm interviewing for:
--- {job_description} ---

Instructions:
1. Answer as if I'm speaking — first person, natural cadence.
2. Weave in specifics from my CV when relevant, don't force them.
3. If the question is vague, give the strongest reasonable interpretation and answer that.
4. End strong — last sentence should land a clear point, not trail off.
"""
        self.system_prompt_text.insert(tk.END, default_system_prompt.strip())

        user_prompt_card = ttk.LabelFrame(scrollable, text="User Prompt (Question Template)", style="Card.TLabelframe")
        user_prompt_card.pack(fill="x", expand=True, pady=(0, 8))
        self.user_prompt_text = scrolledtext.ScrolledText(
            user_prompt_card,
            height=3,
            font=("SF Mono", 12),
            bg=self.TEXT_AREA_BG,
            fg=self.TEXT_COLOR,
            relief="flat",
            borderwidth=0,
            padx=12,
            pady=10,
            insertbackground=self.ACCENT_COLOR,
            wrap=tk.WORD,
        )
        self.user_prompt_text.pack(fill="x", expand=True, padx=10, pady=10)
        self.user_prompt_text.insert(tk.END, 'The latest question from the professor is: "{transcribed_text}"')
        self.refresh_microphone_list()

    def config_payload(self):
        return {
            "api_key": self.api_key_var.get().strip(),
            "window_alpha": round(self.alpha_value, 2),
            "microphone_device_index": self.microphone_device_index,
        }

    def load_config(self):
        try:
            if CONFIG_FILE.exists():
                config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
                self.api_key_var.set(config.get("api_key", "").strip())
                self.alpha_value = float(config.get("window_alpha", DEFAULT_ALPHA))
                self.alpha_value = min(MAX_ALPHA, max(MIN_ALPHA, self.alpha_value))
                self.alpha_percent_var.set(int(self.alpha_value * 100))
                saved_device = config.get("microphone_device_index")
                if isinstance(saved_device, int):
                    self.microphone_device_index = saved_device
        except Exception as err:
            print(f"Config load error: {err}")

    def save_config(self):
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            CONFIG_FILE.write_text(json.dumps(self.config_payload(), indent=2), encoding="utf-8")
        except Exception as err:
            messagebox.showerror("Config Error", f"Could not save config: {err}")

    def save_api_key(self):
        key = self.api_key_var.get().strip()
        if not key:
            messagebox.showwarning("Missing API Key", "Please paste an API key before saving.")
            return
        self.save_config()
        self.update_connection_state()
        self.status_text.set("API key saved")

    def toggle_api_visibility(self):
        self.show_api_key = not self.show_api_key
        self.api_key_entry.configure(show="" if self.show_api_key else "*")
        if self.api_key_entry:
            for child in self.api_key_entry.master.winfo_children():
                if isinstance(child, ttk.Button) and child.cget("text") in {"Show", "Hide"}:
                    child.configure(text="Hide" if self.show_api_key else "Show")
                    break

    def require_api_key(self):
        key = self.api_key_var.get().strip()
        if key:
            return key
        messagebox.showwarning(
            "API Key Required",
            "No API key configured. Go to Setup tab, add your key, and click Save.",
        )
        self.notebook.select(self.setup_tab)
        return None

    def update_connection_state(self):
        has_key = bool(self.api_key_var.get().strip())
        self.connection_text.set("AI: Configured" if has_key else "AI: Not Configured")

    def apply_alpha(self, value):
        alpha = min(MAX_ALPHA, max(MIN_ALPHA, float(value)))
        self.alpha_value = alpha
        self.alpha_percent_var.set(int(alpha * 100))
        self.root.attributes("-alpha", alpha)
        if hasattr(self, "opacity_label"):
            self.opacity_label.config(text=f"{int(alpha * 100)}%")

    def on_opacity_slider(self, _value=None):
        alpha = self.alpha_percent_var.get() / 100.0
        self.apply_alpha(alpha)
        self.save_config()

    def toggle_teleprompter_mode(self):
        self.is_teleprompter_mode = not self.is_teleprompter_mode
        if self.is_teleprompter_mode:
            self.saved_alpha_before_teleprompter = self.alpha_value
            self.root.attributes("-topmost", True)
            self.apply_alpha(TELEPROMPTER_ALPHA)
            self.teleprompter_button.config(text="Teleprompter Mode: On")
            self.status_text.set("Teleprompter mode enabled")
        else:
            self.root.attributes("-topmost", False)
            self.apply_alpha(self.saved_alpha_before_teleprompter)
            self.teleprompter_button.config(text="Teleprompter Mode: Off")
            self.status_text.set("Teleprompter mode disabled")
        self.save_config()

    def find_microphone_device(self):
        try:
            mic_list = sr.Microphone.list_microphone_names()
            self.available_microphones = mic_list
            print(f"Found {len(mic_list)} audio devices")
            for idx, name in enumerate(mic_list):
                lower_name = name.lower()
                if "blackhole" in lower_name:
                    print(f"Using BlackHole device: {name} (index {idx})")
                    return idx
            for idx, name in enumerate(mic_list):
                lower_name = name.lower()
                if "multi" in lower_name or "virtual" in lower_name or "loopback" in lower_name:
                    print(f"Using virtual device: {name} (index {idx})")
                    return idx
            return 0
        except Exception as err:
            print(f"Error detecting devices: {err}")
            return 0

    def get_device_name(self, index):
        try:
            names = sr.Microphone.list_microphone_names()
            self.available_microphones = names
            if 0 <= index < len(names):
                return names[index]
        except Exception:
            pass
        return f"Index {index}"

    def refresh_microphone_list(self):
        try:
            names = sr.Microphone.list_microphone_names()
            self.available_microphones = names
            values = [f"{idx}: {name}" for idx, name in enumerate(names)]
            self.device_combo["values"] = values
            if not values:
                self.device_var.set("")
                self.status_text.set("No microphone devices found")
                return
            if 0 <= self.microphone_device_index < len(names):
                self.device_var.set(values[self.microphone_device_index])
            else:
                self.microphone_device_index = self.find_microphone_device()
                chosen_idx = min(max(self.microphone_device_index, 0), len(values) - 1)
                self.device_var.set(values[chosen_idx])
            self.device_text.set(f"Device: {self.get_device_name(self.microphone_device_index)}")
            self.status_text.set(f"Found {len(names)} input devices")
        except Exception as err:
            self.status_text.set(f"Device refresh failed: {str(err)[:50]}")

    def apply_selected_microphone(self):
        selected = self.device_var.get().strip()
        if not selected:
            return
        try:
            idx = int(selected.split(":", 1)[0].strip())
            self.microphone_device_index = idx
            self.device_text.set(f"Device: {self.get_device_name(idx)}")
            self.save_config()
            self.status_text.set(f"Using input device index {idx}")
        except Exception:
            self.status_text.set("Could not parse selected device")

    def on_closing(self):
        self.is_closing = True
        if self.stop_listening:
            self.stop_listening(wait_for_stop=False)
        if self.is_recording:
            self.stop_recording()
        self.save_config()
        self.root.destroy()

    def audio_callback(self, recognizer, audio):
        def process_audio():
            try:
                text = recognizer.recognize_whisper(audio, model="base.en", language="en")
                if text and text.strip():
                    app_queue.put(text)
                    self.last_transcription_time = time.time()
                    self.root.after(0, lambda: self.capture_text.set("Capture: transcribed"))
                else:
                    self.root.after(0, lambda: self.capture_text.set("Capture: silence"))
            except sr.UnknownValueError:
                self.root.after(0, lambda: self.capture_text.set("Capture: unrecognized speech"))
            except Exception as err:
                error_msg = str(err).lower()
                if "could not" not in error_msg and "not understand" not in error_msg:
                    print(f"Transcription error: {str(err)[:100]}")
                self.root.after(0, lambda: self.capture_text.set("Capture: transcription error"))

        threading.Thread(target=process_audio, daemon=True).start()

    def toggle_listening(self):
        if self.stop_listening:
            self.stop_listening(wait_for_stop=False)
            self.stop_listening = None
            self.listening_source = None
            self.toggle_button.config(text="Start Listening")
            self.status_label.config(text="Status: Paused")
            self.listening_indicator.itemconfig(self.indicator_light, fill=self.DANGER_COLOR)
            self.listening_indicator.itemconfig(self.indicator_ring, outline="", width=0)
            self.status_text.set("Listening paused")
            self.capture_text.set("Capture: idle")
        else:
            try:
                # Use a short calibration pass on a temporary source, then create a
                # fresh source for background listening to avoid source lifecycle issues.
                calibration_source = sr.Microphone(device_index=self.microphone_device_index)
                with calibration_source as source_for_calibration:
                    self.recognizer.adjust_for_ambient_noise(source_for_calibration, duration=0.4)
                    self.recognizer.energy_threshold = max(500, int(self.recognizer.energy_threshold * 0.8))

                self.listening_source = sr.Microphone(device_index=self.microphone_device_index)
                self.stop_listening = self.recognizer.listen_in_background(
                    self.listening_source,
                    self.audio_callback,
                    phrase_time_limit=20,
                )
                self.toggle_button.config(text="Pause Listening")
                self.status_label.config(text="Status: Listening")
                self.listening_indicator.itemconfig(self.indicator_light, fill=self.SUCCESS_COLOR)
                self.listening_indicator.itemconfig(self.indicator_ring, outline=self.SUCCESS_COLOR, width=2)
                self.status_text.set("Listening for speech...")
                self.capture_text.set("Capture: waiting for audio")
            except Exception as err:
                print(f"Error starting listener: {err}")
                self.status_label.config(text="Status: Error")
                self.status_text.set("Microphone error")
                self.listening_indicator.itemconfig(self.indicator_light, fill=self.DANGER_COLOR)
                self.listening_indicator.itemconfig(self.indicator_ring, outline="", width=0)
                self.capture_text.set("Capture: error")

    def clear_text(self):
        self.question_text.delete("1.0", tk.END)
        self.suggestion_text.config(state="normal")
        self.suggestion_text.delete("1.0", tk.END)
        self.suggestion_text.config(state="disabled")
        self.status_text.set("Text cleared")

    def clear_history(self):
        self.conversation_history = []
        self.update_history_label()
        self.status_text.set("Conversation history cleared")

    def update_history_label(self):
        self.history_label.config(text=f"History: {len(self.conversation_history)}/{self.max_history}")

    def fetch_suggestion(self):
        question = self.question_text.get("1.0", tk.END).strip()
        if not question:
            return

        api_key = self.require_api_key()
        if not api_key:
            return

        try:
            cv = self.cv_text.get("1.0", tk.END).strip()
            jd = self.jd_text.get("1.0", tk.END).strip()
            system_prompt_template = self.system_prompt_text.get("1.0", tk.END).strip()
            user_prompt_template = self.user_prompt_text.get("1.0", tk.END).strip()
            final_system_prompt = system_prompt_template.format(cv=cv, job_description=jd)
            final_user_question = user_prompt_template.format(transcribed_text=question)
        except KeyError as err:
            messagebox.showerror("Template Error", f"Prompt template has a missing placeholder: {err}")
            return
        except Exception as err:
            messagebox.showerror("Prompt Error", f"Could not prepare prompts: {err}")
            return

        self.update_connection_state()
        self.get_suggestion_button.config(text="Getting...", state="disabled")
        self.suggestion_text.config(state="normal")
        self.suggestion_text.delete("1.0", tk.END)
        self.suggestion_text.insert(tk.END, "Thinking...")
        self.suggestion_text.config(state="disabled")
        self.status_text.set("Requesting AI suggestion...")
        self.root.update()

        threading.Thread(
            target=self._get_suggestion_thread,
            args=(final_user_question, final_system_prompt, question, api_key),
            daemon=True,
        ).start()

    def _get_suggestion_thread(self, user_question, system_prompt, original_question, api_key):
        suggestion = get_ai_suggestion(user_question, system_prompt, api_key, self.conversation_history)
        self.root.after(0, self.update_suggestion_text, suggestion, original_question)

    def update_suggestion_text(self, suggestion, question):
        self.suggestion_text.config(state="normal")
        self.suggestion_text.delete("1.0", tk.END)
        self.suggestion_text.insert(tk.END, suggestion)
        self.suggestion_text.config(state="disabled")
        self.get_suggestion_button.config(text="Get AI Suggestion", state="normal")
        self.status_text.set("AI response ready")

        if question and suggestion:
            self.conversation_history.append((question, suggestion))
            if len(self.conversation_history) > self.max_history:
                self.conversation_history.pop(0)
            self.update_history_label()

    def check_queue(self):
        try:
            message = app_queue.get_nowait()
            current_text = self.question_text.get("1.0", tk.END).strip()
            if not current_text:
                self.question_text.insert(tk.END, message)
            else:
                self.question_text.insert(tk.END, "\n" + message)
            self.question_text.see(tk.END)
        except queue.Empty:
            pass
        finally:
            if not self.is_closing:
                self.root.after(100, self.check_queue)

    def toggle_recording(self):
        if self.is_recording:
            self.stop_recording()
        else:
            self.start_recording()

    def start_recording(self):
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            if not os.path.exists("recordings"):
                os.makedirs("recordings")
            self.recording_file = f"recordings/recording_{timestamp}.wav"

            self.pyaudio_instance = pyaudio.PyAudio()
            chunk = 1024
            audio_format = pyaudio.paInt16
            channels = 1
            rate = 44100
            self.audio_stream = self.pyaudio_instance.open(
                format=audio_format,
                channels=channels,
                rate=rate,
                input=True,
                input_device_index=self.microphone_device_index,
                frames_per_buffer=chunk,
            )
            self.is_recording = True
            self.record_start_time = time.time()
            self.record_button.config(text="Stop Recording")
            self.recording_status_label.config(
                text=f"Recording to: {os.path.basename(self.recording_file)}",
                foreground=self.SUCCESS_COLOR,
            )
            self.status_text.set("Recording started")
            self.recording_thread = threading.Thread(target=self._record_audio, daemon=True)
            self.recording_thread.start()
        except Exception as err:
            print(f"Error starting recording: {err}")
            self.recording_status_label.config(text=f"Error: {str(err)[:60]}", foreground=self.DANGER_COLOR)
            self.status_text.set("Recording failed")
            if self.audio_stream:
                self.audio_stream.stop_stream()
                self.audio_stream.close()
            if self.pyaudio_instance:
                self.pyaudio_instance.terminate()
                self.pyaudio_instance = None

    def stop_recording(self):
        self.is_recording = False
        if self.recording_thread and self.recording_thread.is_alive():
            self.recording_thread.join(timeout=2)

        self.record_button.config(text="Start Recording")
        if self.recording_file:
            self.recording_status_label.config(
                text=f"Saved: {os.path.basename(self.recording_file)}",
                foreground=self.TEXT_SECONDARY,
            )
            self.status_text.set("Recording saved")
        else:
            self.recording_status_label.config(text="")
            self.status_text.set("Recording stopped")
        self.record_start_time = None
        self.recording_duration_text.set("Recording: 00:00")

    def update_recording_duration(self):
        if self.is_recording and self.record_start_time:
            elapsed = int(time.time() - self.record_start_time)
            minutes = elapsed // 60
            seconds = elapsed % 60
            self.recording_duration_text.set(f"Recording: {minutes:02d}:{seconds:02d}")
        if not self.is_closing:
            self.root.after(1000, self.update_recording_duration)

    def _record_audio(self):
        chunk = 1024
        audio_format = pyaudio.paInt16
        channels = 1
        rate = 44100
        frames = []
        try:
            while self.is_recording and self.audio_stream:
                data = self.audio_stream.read(chunk, exception_on_overflow=False)
                frames.append(data)
        except Exception as err:
            print(f"Error during recording: {err}")
        finally:
            if frames and self.recording_file:
                try:
                    wf = wave.open(self.recording_file, "wb")
                    wf.setnchannels(channels)
                    if self.pyaudio_instance:
                        wf.setsampwidth(self.pyaudio_instance.get_sample_size(audio_format))
                    else:
                        wf.setsampwidth(2)
                    wf.setframerate(rate)
                    wf.writeframes(b"".join(frames))
                    wf.close()
                    print(f"Recording saved to: {self.recording_file}")
                except Exception as err:
                    print(f"Error saving recording: {err}")

            if self.audio_stream:
                try:
                    self.audio_stream.stop_stream()
                    self.audio_stream.close()
                except Exception:
                    pass
            if self.pyaudio_instance:
                try:
                    self.pyaudio_instance.terminate()
                except Exception:
                    pass
            self.pyaudio_instance = None
            self.audio_stream = None


if __name__ == "__main__":
    root = tk.Tk()
    app = AssistantApp(root)
    root.mainloop()

