"""Validate the identity of a single saved-race API response."""


def saved_race(payload, timestamp):
    """Reject a list response, missing ID or wrong record before any mutation."""
    if not isinstance(payload, dict):
        raise ValueError('Saved-race response must be an object')
    races = payload.get('races')
    if not isinstance(races, list) or len(races) != 1:
        raise ValueError('Expected exactly one saved race')
    race = races[0]
    if not isinstance(race, dict) or race.get('timestamp') != timestamp:
        raise ValueError(f'Saved-race identity does not match requested ID {timestamp}')
    return race
