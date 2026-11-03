"""Shared dufcad / convocation matching (e.g. '5aad' vs 'Dufcadda 5')."""
import re


def dufcad_number_key(convocation):
    m = re.search(r'(\d+)', convocation or '')
    if m:
        return m.group(1)
    return (convocation or '').strip().lower()


def _is_alnuur(convocation):
    return (convocation or '').strip().lower().replace('-', '') == 'alnuur'


def convocations_match(meeting_conv, member_conv):
    """
    True when a meeting's convocation targets this member.
    Handles 'All', numeric dufcad aliases, and Alnuur.
    """
    mc = (meeting_conv or '').strip()
    uc = (member_conv or '').strip()
    if not mc or mc.lower() == 'all':
        return True
    if not uc:
        return False
    if _is_alnuur(mc) or _is_alnuur(uc):
        return _is_alnuur(mc) and _is_alnuur(uc)
    mk = dufcad_number_key(mc)
    uk = dufcad_number_key(uc)
    if mk.isdigit() and uk.isdigit():
        return mk == uk
    return mc.lower() == uc.lower()
