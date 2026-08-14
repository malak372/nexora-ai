class PaymentCurrencyOption {
  const PaymentCurrencyOption({
    required this.code,
    required this.name,
    required this.symbol,
  });

  final String code;
  final String name;
  final String symbol;
}

const paymentCurrencyOptions = <PaymentCurrencyOption>[
  PaymentCurrencyOption(code: 'USD', name: 'US Dollar', symbol: r'$'),
  PaymentCurrencyOption(code: 'EUR', name: 'Euro', symbol: '€'),
  PaymentCurrencyOption(code: 'GBP', name: 'British Pound', symbol: '£'),
  PaymentCurrencyOption(code: 'ILS', name: 'Israeli New Shekel', symbol: '₪'),
  PaymentCurrencyOption(code: 'AED', name: 'UAE Dirham', symbol: 'د.إ'),
];

class PaymentCurrencyPreference {
  PaymentCurrencyPreference._();

  static final Set<String> _codes =
      paymentCurrencyOptions.map((currency) => currency.code).toSet();

  static String _current = 'USD';

  static String get current => _current;

  static PaymentCurrencyOption optionFor(String value) {
    final normalized = value.trim().toUpperCase();
    return paymentCurrencyOptions.firstWhere(
      (option) => option.code == normalized,
      orElse: () => paymentCurrencyOptions.first,
    );
  }

  static set current(String value) {
    final normalized = value.trim().toUpperCase();
    _current = _codes.contains(normalized) ? normalized : 'USD';
  }
}
