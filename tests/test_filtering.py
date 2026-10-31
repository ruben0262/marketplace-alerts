import unittest
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from listing_monitor.config import SearchConfig
from listing_monitor.models import Listing, parse_decimal
from listing_monitor.filtering import matches_search
from listing_monitor.marketplaces.vinted import VintedAdapter
from listing_monitor.marketplaces.ebay import EbayAdapter


class MatchingBehavior(unittest.TestCase):
    def listing(self, **changes):
        return Listing(**{"source": "vinted", "marketplace": "www.vinted.fr", "listing_id": "1", "title": "BOXRAW men's jacket", "url": "https://www.vinted.fr/items/1", "price": Decimal("28"), "attributes": {"Brand": "Boxraw", "Size": "M"}, **changes})

    def test_size_exclusions_do_not_reject_mens_or_words_with_s(self):
        search = SearchConfig("Boxraw", "boxraw", excluded_sizes=["s", "xs"])
        self.assertTrue(matches_search(self.listing(), search))
        for size in ["S", "Small", "X-Small", "Extra small", "XS / 34"]:
            self.assertFalse(matches_search(self.listing(attributes={"Size": size}), search), size)

    def test_brands_are_normalized_but_similar_brand_names_do_not_pass(self):
        search = SearchConfig("Adidas", "adidas", required_brands=["adidas"])
        self.assertTrue(matches_search(self.listing(attributes={"Brand": "Adídas"}), search))
        self.assertFalse(matches_search(self.listing(attributes={"Brand": "Adidas-style"}), search))

    def test_budget_age_and_keywords_filter_the_results(self):
        search = SearchConfig("Jackets", "jacket", min_price=Decimal("20"), max_price=Decimal("40"), exclude_keywords=["kids"], include_keywords=["jacket"])
        self.assertTrue(matches_search(self.listing(price=Decimal("40")), search))
        self.assertFalse(matches_search(self.listing(price=Decimal("41")), search))
        self.assertFalse(matches_search(self.listing(title="BOXRAW kids jacket"), search))
        self.assertFalse(matches_search(self.listing(created_at=datetime.now(UTC) - timedelta(days=2)), search))
        self.assertTrue(matches_search(self.listing(created_at=None), search))

    def test_each_keyword_group_requires_one_alternative(self):
        search = SearchConfig("Clothes", "clothes", include_any_groups=[["jacket", "sweatshirt"], ["vintage", "retro"]])
        self.assertTrue(matches_search(self.listing(title="Retro sweatshirt"), search))
        self.assertFalse(matches_search(self.listing(title="Retro trousers"), search))

    def test_current_vinted_cards_preserve_brand_size_condition_and_price(self):
        listing = VintedAdapter._parse_item({"id": 123, "title": "Jacket", "url": "/items/123", "price": {"amount": "28.50", "currency_code": "EUR"}, "item_box": {"first_line": "Boxraw", "second_line": "M · Very good"}}, "www.vinted.fr", "Boxraw", "https://www.vinted.fr")
        self.assertEqual(listing.attributes, {"Brand": "Boxraw", "Size": "M", "Condition": "Very good"})
        self.assertEqual(listing.price, Decimal("28.50"))
        self.assertEqual(listing.url, "https://www.vinted.fr/items/123")

    def test_ebay_search_terms_remain_exact_phrases(self):
        for query in ["boxraw", "vintage jacket", '"boxraw"']:
            phrase = EbayAdapter._exact_phrase(query)
            self.assertTrue(phrase.startswith('"') and phrase.endswith('"'))
            self.assertNotIn('""', phrase)

    def test_missing_or_nonfinite_marketplace_prices_are_not_crashes(self):
        for value in [None, "not a price", "NaN", "Infinity", "-Infinity"]:
            self.assertIsNone(parse_decimal(value))
        self.assertEqual(parse_decimal("19.95"), Decimal("19.95"))


if __name__ == '__main__':
    unittest.main()
