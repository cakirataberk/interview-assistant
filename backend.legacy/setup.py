# setup.py
from setuptools import setup

APP = ["assistant.py"]
DATA_FILES = ["cv.txt", "job_description.txt"]

OPTIONS = {
    "argv_emulation": False,
    "iconfile": None,
    "plist": {
        "CFBundleName": "Interview Assistant",
        "CFBundleDisplayName": "Interview Assistant",
        "CFBundleIdentifier": "com.interviewassistant.app",
        "CFBundleVersion": "1.0.0",
        "CFBundleShortVersionString": "1.0.0",
    },
    "packages": [
        "google",
        "google.generativeai",
        "speech_recognition",
        "whisper",
        "pyaudio",
        "tkinter",
    ],
    "includes": [
        "tkinter",
        "tkinter.ttk",
        "tkinter.scrolledtext",
        "speech_recognition",
        "google.generativeai",
        "pyaudio",
        "whisper",
    ],
    "excludes": ["matplotlib", "scipy.tests"],
    "frameworks": [],
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
