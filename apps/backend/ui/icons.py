"""
Icon Definitions
================

Provides icon symbols with Unicode and ASCII fallbacks based on terminal capabilities.
"""

from .capabilities import UNICODE


class Icons:
    """Icon definitions with Unicode and ASCII fallbacks."""

    # Status icons
    SUCCESS = ("✓", "[OK]")
    ERROR = ("✗", "[X]")
    WARNING = ("⚠", "[!]")
    INFO = ("ℹ", "[i]")
    PENDING = ("○", "[ ]")
    IN_PROGRESS = ("◐", "[.]")
    COMPLETE = ("●", "[*]")
    BLOCKED = ("⊘", "[B]")

    # Action icons
    PLAY = ("▶", ">")
    PAUSE = ("⏸", "||")
    STOP = ("⏹", "[]")
    SKIP = ("⏭", ">>")

    # Navigation
    ARROW_RIGHT = ("→", "->")
    ARROW_DOWN = ("↓", "v")
    ARROW_UP = ("↑", "^")
    POINTER = ("❯", ">")
    BULLET = ("•", "*")

    # Objects
    FOLDER = ("📁", "[D]")
    FILE = ("📄", "[F]")
    GEAR = ("⚙", "[*]")
    SEARCH = ("🔍", "[?]")
    BRANCH = ("🌿", "[BR]")  # [BR] to avoid collision with BLOCKED [B]
    COMMIT = ("◉", "(@)")
    LIGHTNING = ("⚡", "!")
    LINK = ("🔗", "[L]")  # For PR URLs

    # Progress
    SUBTASK = ("▣", "#")
    PHASE = ("◆", "*")
    WORKER = ("⚡", "W")
    SESSION = ("▸", ">")

    # Menu
    EDIT = ("✏️", "[E]")
    CLIPBOARD = ("📋", "[C]")
    DOCUMENT = ("📄", "[D]")
    DOOR = ("🚪", "[Q]")
    SHIELD = ("🛡️", "[S]")

    # Box drawing (always ASCII fallback for compatibility)
    BOX_TL = ("╔", "+")
    BOX_TR = ("╗", "+")
    BOX_BL = ("╚", "+")
    BOX_BR = ("╝", "+")
    BOX_H = ("═", "-")
    BOX_V = ("║", "|")
    BOX_ML = ("╠", "+")
    BOX_MR = ("╣", "+")
    BOX_TL_LIGHT = ("┌", "+")
    BOX_TR_LIGHT = ("┐", "+")
    BOX_BL_LIGHT = ("└", "+")
    BOX_BR_LIGHT = ("┘", "+")
    BOX_H_LIGHT = ("─", "-")
    BOX_V_LIGHT = ("│", "|")
    BOX_ML_LIGHT = ("├", "+")
    BOX_MR_LIGHT = ("┤", "+")

    # Progress bar
    BAR_FULL = ("█", "=")
    BAR_EMPTY = ("░", "-")
    BAR_HALF = ("▌", "=")


def icon(icon_tuple: tuple[str, str]) -> str:
    """
    Get the appropriate icon based on terminal capabilities.

    Args:
        icon_tuple: Tuple of (unicode_icon, ascii_fallback)

    Returns:
        Unicode icon if supported, otherwise ASCII fallback
    """
    return icon_tuple[0] if UNICODE else icon_tuple[1]
