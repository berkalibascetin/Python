import Foundation
import EventKit

/// Örnek EventKit entegrasyonu: takvim etkinliklerini listeler ve
/// yeni bir hatırlatıcı ekler. Orijinal Jarvis'teki "Bugün ne var?" /
/// "Bunu hatırlat" komutlarının iOS-native karşılığı.
final class EventKitService {
    private let store = EKEventStore()

    func requestAccess() async -> Bool {
        let calendarGranted = (try? await store.requestFullAccessToEvents()) ?? false
        let remindersGranted = (try? await store.requestFullAccessToReminders()) ?? false
        return calendarGranted && remindersGranted
    }

    /// Belirtilen tarih aralığındaki takvim etkinliklerini döner.
    func events(from startDate: Date, to endDate: Date) -> [EKEvent] {
        let predicate = store.predicateForEvents(withStart: startDate, end: endDate, calendars: nil)
        return store.events(matching: predicate)
    }

    /// Yeni bir hatırlatıcı oluşturur.
    @discardableResult
    func addReminder(title: String, dueDate: Date?) throws -> EKReminder {
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.calendar = store.defaultCalendarForNewReminders()

        if let dueDate {
            reminder.dueDateComponents = Calendar.current.dateComponents(
                [.year, .month, .day, .hour, .minute],
                from: dueDate
            )
        }

        try store.save(reminder, commit: true)
        return reminder
    }
}
