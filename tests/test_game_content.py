"""Regression checks for automatic game video and Wikipedia summary matching."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fetch_game_stories as stories
import fetch_videos as videos


class VideoMatching(unittest.TestCase):
    game = dict(y=2017, g='WS G5', gt='World Series, Game 5',
                nm=['Los Angeles Dodgers', 'Houston Astros'])

    def test_correct_broadcast(self):
        self.assertTrue(videos.relevant(self.game, '2017 World Series Game 5 Astros vs Dodgers'))

    def test_wrong_season_or_game(self):
        for title in ['2014 World Series Game 5 Giants vs Royals',
                      '2017 World Series Game 7 Astros vs Dodgers',
                      'World Series G5: Giants vs. Royals [Full Game HD]']:
            with self.subTest(title=title):
                self.assertFalse(videos.relevant(self.game, title))

    def test_fan_streams_and_simulations(self):
        for suffix in ['watch party', 'WATCH ALONG', 'MLB The Show 22', 'MLB 2K12', 'simulated game']:
            with self.subTest(suffix=suffix):
                self.assertFalse(videos.relevant(self.game, '2017 World Series Game 5 ' + suffix))

    def test_regular_season_date(self):
        game = dict(y=1975, g='6/22 KCR-OAK', gt='June 22',
                    nm=['Kansas City Royals', 'Oakland Athletics'])
        self.assertTrue(videos.relevant(game, '1975 06 22 Royals at Athletics'))
        self.assertFalse(videos.relevant(game, '1975 June 15 Royals at Athletics'))


class StoryMatching(unittest.TestCase):
    article = '''== Matchups ==
=== Houston Astros vs. Seattle Mariners ===
=== New York Yankees vs. Cleveland Guardians ===
== Houston vs. Seattle ==
=== Game 3 ===
This is the Seattle game, which must never appear on the Cleveland game page.
== New York vs. Cleveland ==
=== Game 3 ===
This is the Cleveland game, matched using the city heading above the game section.
'''

    def test_city_heading_and_repeated_anchor(self):
        game = dict(y=2022, gt='American League Division Series, Game 3',
                    nm=['New York Yankees', 'Cleveland Guardians'])
        with patch.object(stories, 'extract', return_value=('2022 American League Division Series', self.article)):
            paragraphs, url, _ = stories.story(game)
        self.assertIn('Cleveland game', paragraphs[0])
        self.assertTrue(url.endswith('#Game_3_2'))

    def test_unknown_matchup_never_uses_first_game(self):
        game = dict(y=2022, gt='American League Division Series, Game 3',
                    nm=['Detroit Tigers', 'Baltimore Orioles'])
        with patch.object(stories, 'extract', return_value=('2022 American League Division Series', self.article)):
            self.assertIsNone(stories.story(game))

    def test_punctuation_and_dateline(self):
        self.assertEqual(stories.fold('St. Louis'), 'st louis')
        self.assertEqual(stories.paras('Wednesday, October 7, 1998, at Yankee Stadium in New York City.'), [])


if __name__ == '__main__':
    unittest.main()
