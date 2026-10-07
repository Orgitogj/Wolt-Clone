jest.mock('@/lib/supabase', () => ({
  supabase: require('./helpers/supabase').createSupabaseMock(),
}));

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockParams: { id?: string } = { id: 'order-1' };

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'client-fixed' }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockAuthState: { user: { id: string } | null } = { user: { id: 'admin-1' } };

jest.mock('@/hooks/use-auth-store', () => ({
  __esModule: true,
  default: (selector: (state: typeof mockAuthState) => unknown) => selector(mockAuthState),
}));

const mockOrder: { order: unknown } = { order: null };

jest.mock('@/hooks/useOrderTracking', () => ({
  useOrderTracking: () => mockOrder,
}));

const mockEligibility = jest.fn();
const mockSubmit = jest.fn();
const mockApprove = jest.fn();
const mockConfirmCash = jest.fn();
const mockSetStatus = jest.fn();
const mockAssign = jest.fn();
const mockMarkRead = jest.fn(() => Promise.resolve());

const mockState = {
  ticket: null as unknown,
  isTicketLoading: false,
  refunds: [] as unknown[],
  summary: null as unknown,
  reportedItems: [] as unknown[],
};

jest.mock('@/hooks/useSupport', () => ({
  useSupportEligibility: () => mockEligibility(),
  useSubmitSupportTicket: () => ({ mutateAsync: mockSubmit, isPending: false }),
  useSupportConversation: () => ({
    ticket: mockState.ticket,
    ticketError: null,
    isTicketLoading: mockState.isTicketLoading,
    messages: [],
    outgoing: [],
    canRead: !!mockState.ticket,
    isLoading: false,
    hasOlder: false,
    isLoadingOlder: false,
    isOlderError: false,
    send: jest.fn(),
    retry: jest.fn(),
    discard: jest.fn(),
    markRead: mockMarkRead,
    loadOlder: jest.fn(),
  }),
  useSupportRefunds: () => ({ data: mockState.refunds }),
  useOrderRefundSummary: () => ({ data: mockState.summary }),
  useSupportReportedItems: () => ({ data: mockState.reportedItems }),
  useAssignSupportTicket: () => ({ mutateAsync: mockAssign, isPending: false }),
  useSetSupportStatus: () => ({ mutateAsync: mockSetStatus, isPending: false }),
  useApproveSupportRefund: () => ({ mutateAsync: mockApprove, isPending: false }),
  useConfirmCashRefund: () => ({ mutateAsync: mockConfirmCash, isPending: false }),
  mergeSupportTimeline: () => [],
}));

import AdminTicketScreen from '@/app/(app)/(auth)/admin/support-ticket';
import ReportScreen from '@/app/(app)/(auth)/order/support';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const eligible = {
  data: { can_report: true, reason: 'eligible', open_ticket_id: null, closes_at: null },
  isLoading: false,
  error: null,
  refetch: jest.fn(),
};

const orderWithItems = {
  id: 'order-1',
  restaurant: { name: 'Support Kitchen' },
  order_items: [
    { id: 'item-1', dish_name: 'Pizza', quantity: 2, unit_price: 10, line_total: 20 },
    { id: 'item-2', dish_name: 'Salad', quantity: 1, unit_price: 5, line_total: 5 },
  ],
};

const ticket = {
  id: 'ticket-1',
  order_id: 'order-1',
  user_id: 'user-a',
  restaurant_name: 'Support Kitchen',
  category: 'missing_items',
  status: 'open',
  description: 'One dish was missing',
  assigned_admin_id: null,
  assigned_admin_name: null,
  revision: 3,
  reopened_count: 0,
  created_at: '2026-02-01T10:00:00.000Z',
  updated_at: '2026-02-01T10:00:00.000Z',
  resolved_at: null,
  order_total: 30,
  payment_method: 'card',
  viewer_role: 'admin',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.id = 'order-1';
  mockAuthState.user = { id: 'admin-1' };
  mockOrder.order = orderWithItems;
  mockEligibility.mockReturnValue(eligible);
  mockSubmit.mockResolvedValue({ id: 'ticket-1' });
  mockState.ticket = ticket;
  mockState.isTicketLoading = false;
  mockState.refunds = [];
  mockState.summary = {
    charged: 30,
    confirmed_refunds: 0,
    reserved_refunds: 0,
    remaining_refundable: 12,
    currency: 'EUR',
    method: 'card',
  };
  mockState.reportedItems = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

describe('reporting a problem', () => {
  it('keeps the report locked until a category and a description are given', () => {
    render(<ReportScreen />);

    expect(screen.getByTestId('support-submit').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('support-category-late_delivery'));
    expect(screen.getByTestId('support-submit').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByTestId('support-description-input'), 'An hour late');
    expect(screen.getByTestId('support-submit').props.accessibilityState.disabled).toBe(false);
  });

  it('asks for items before an item problem can be sent', () => {
    render(<ReportScreen />);

    fireEvent.press(screen.getByTestId('support-category-missing_items'));
    fireEvent.changeText(screen.getByTestId('support-description-input'), 'The pizza never came');

    expect(screen.getByTestId('support-submit').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('support-item-plus-item-1'));
    expect(screen.getByTestId('support-submit').props.accessibilityState.disabled).toBe(false);
  });

  it('never reports more of an item than was ordered', () => {
    render(<ReportScreen />);
    fireEvent.press(screen.getByTestId('support-category-missing_items'));

    fireEvent.press(screen.getByTestId('support-item-plus-item-2'));
    fireEvent.press(screen.getByTestId('support-item-plus-item-2'));
    fireEvent.press(screen.getByTestId('support-item-plus-item-2'));

    expect(screen.getByTestId('support-item-count-item-2')).toHaveTextContent('1');
  });

  it('never reports a negative quantity', () => {
    render(<ReportScreen />);
    fireEvent.press(screen.getByTestId('support-category-missing_items'));

    fireEvent.press(screen.getByTestId('support-item-minus-item-1'));

    expect(screen.getByTestId('support-item-count-item-1')).toHaveTextContent('0');
  });

  it('sends the trimmed description with the chosen items', async () => {
    render(<ReportScreen />);

    fireEvent.press(screen.getByTestId('support-category-missing_items'));
    fireEvent.changeText(screen.getByTestId('support-description-input'), '  The pizza was gone  ');
    fireEvent.press(screen.getByTestId('support-item-plus-item-1'));
    fireEvent.press(screen.getByTestId('support-item-plus-item-1'));
    fireEvent.press(screen.getByTestId('support-submit'));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit).toHaveBeenCalledWith({
      category: 'missing_items',
      description: 'The pizza was gone',
      items: [{ order_item_id: 'item-1', quantity: 2 }],
      clientTicketId: 'client-fixed',
    });
  });

  it('leaves the items out of a problem that has none', async () => {
    render(<ReportScreen />);

    fireEvent.press(screen.getByTestId('support-category-late_delivery'));
    fireEvent.changeText(screen.getByTestId('support-description-input'), 'An hour late');
    fireEvent.press(screen.getByTestId('support-submit'));

    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
    expect(mockSubmit).toHaveBeenCalledWith(expect.objectContaining({ items: [] }));
  });

  it('opens the new report once it is sent', async () => {
    render(<ReportScreen />);

    fireEvent.press(screen.getByTestId('support-category-other'));
    fireEvent.changeText(screen.getByTestId('support-description-input'), 'Something else');
    fireEvent.press(screen.getByTestId('support-submit'));

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/order/support-ticket',
        params: { id: 'ticket-1' },
      })
    );
  });

  it('explains a refusal instead of leaving the form open', async () => {
    mockSubmit.mockRejectedValue(new Error('You already have an open report for this order'));
    render(<ReportScreen />);

    fireEvent.press(screen.getByTestId('support-category-other'));
    fireEvent.changeText(screen.getByTestId('support-description-input'), 'Another problem');
    fireEvent.press(screen.getByTestId('support-submit'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offers the open report instead of a second form', () => {
    mockEligibility.mockReturnValue({
      ...eligible,
      data: {
        can_report: false,
        reason: 'already_open',
        open_ticket_id: 'ticket-9',
        closes_at: null,
      },
    });

    render(<ReportScreen />);

    expect(screen.getByTestId('support-report-blocked')).toBeTruthy();
    fireEvent.press(screen.getByTestId('support-open-existing'));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/order/support-ticket',
      params: { id: 'ticket-9' },
    });
  });

  it('never shows the form for an order of another account', () => {
    mockEligibility.mockReturnValue({
      ...eligible,
      data: {
        can_report: false,
        reason: 'not_your_order',
        open_ticket_id: null,
        closes_at: null,
      },
    });

    render(<ReportScreen />);

    expect(screen.queryByTestId('support-submit')).toBeNull();
    expect(screen.getByText(/another account/i)).toBeTruthy();
  });
});

describe('the admin refund controls', () => {
  beforeEach(() => {
    mockParams.id = 'ticket-1';
  });

  it('keeps approval locked until an amount and a reason are given', () => {
    render(<AdminTicketScreen />);

    expect(screen.getByTestId('admin-refund-approve').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByTestId('admin-refund-amount'), '5.00');
    expect(screen.getByTestId('admin-refund-approve').props.accessibilityState.disabled).toBe(true);

    fireEvent.changeText(screen.getByTestId('admin-refund-reason'), 'missing dish');
    expect(screen.getByTestId('admin-refund-approve').props.accessibilityState.disabled).toBe(
      false
    );
  });

  it('refuses an amount above the remaining balance before asking the server', () => {
    render(<AdminTicketScreen />);

    fireEvent.changeText(screen.getByTestId('admin-refund-amount'), '12.01');
    fireEvent.changeText(screen.getByTestId('admin-refund-reason'), 'too much');

    expect(screen.getByTestId('admin-refund-balance-error')).toBeTruthy();
    expect(screen.getByTestId('admin-refund-approve').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('admin-refund-approve'));
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('explains an amount it cannot read', () => {
    render(<AdminTicketScreen />);

    fireEvent.changeText(screen.getByTestId('admin-refund-amount'), 'ten euro');

    expect(screen.getByTestId('admin-refund-amount-error')).toBeTruthy();
  });

  it('shows what is still refundable', () => {
    render(<AdminTicketScreen />);

    expect(screen.getByTestId('admin-ticket-remaining')).toHaveTextContent(/12\.00/);
    expect(screen.getByTestId('admin-ticket-remaining')).toHaveTextContent(/30\.00/);
  });

  it('asks for confirmation before any money moves', () => {
    render(<AdminTicketScreen />);

    fireEvent.changeText(screen.getByTestId('admin-refund-amount'), '5');
    fireEvent.changeText(screen.getByTestId('admin-refund-reason'), 'missing dish');
    fireEvent.press(screen.getByTestId('admin-refund-approve'));

    expect(Alert.alert).toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it('sends the chosen liability with the approval', async () => {
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons) =>
        (buttons?.[1]?.onPress as () => void)?.()
      );

    render(<AdminTicketScreen />);

    fireEvent.changeText(screen.getByTestId('admin-refund-amount'), '4,50');
    fireEvent.changeText(screen.getByTestId('admin-refund-reason'), 'restaurant fault');
    fireEvent.press(screen.getByTestId('admin-refund-liability-restaurant'));
    fireEvent.press(screen.getByTestId('admin-refund-approve'));

    await waitFor(() => expect(mockApprove).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith({
      amount: 4.5,
      reason: 'restaurant fault',
      liability: 'restaurant',
      clientRequestId: 'client-fixed',
    });
  });

  it('sends the revision it is showing so a stale screen cannot overwrite', async () => {
    render(<AdminTicketScreen />);

    fireEvent.press(screen.getByTestId('admin-ticket-take'));

    await waitFor(() => expect(mockAssign).toHaveBeenCalled());
    expect(mockAssign).toHaveBeenCalledWith({ adminId: 'admin-1', revision: 3 });
  });

  it('refuses to resolve while a refund is still being processed', () => {
    mockState.refunds = [
      {
        id: 'refund-1',
        amount: 5,
        currency: 'EUR',
        method: 'card',
        liability: 'platform',
        state: 'reserved',
        reason: 'missing dish',
        failure_reason: null,
        approved_at: '2026-02-01T10:00:00.000Z',
        settled_at: null,
      },
    ];

    render(<AdminTicketScreen />);

    expect(screen.getByTestId('admin-ticket-resolve-blocked')).toBeTruthy();
    expect(screen.getByTestId('admin-ticket-resolve').props.accessibilityState.disabled).toBe(true);

    fireEvent.press(screen.getByTestId('admin-ticket-resolve'));
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it('offers the cash confirmation only for a cash refund that is waiting', () => {
    mockState.refunds = [
      {
        id: 'refund-cash',
        amount: 4,
        currency: 'EUR',
        method: 'cash',
        liability: 'platform',
        state: 'reserved',
        reason: 'late delivery',
        failure_reason: null,
        approved_at: '2026-02-01T10:00:00.000Z',
        settled_at: null,
      },
    ];

    render(<AdminTicketScreen />);

    expect(screen.getByTestId('admin-refund-confirm-cash')).toBeTruthy();
  });

  it('asks for a settlement note before confirming cash', async () => {
    mockState.refunds = [
      {
        id: 'refund-cash',
        amount: 4,
        currency: 'EUR',
        method: 'cash',
        liability: 'platform',
        state: 'reserved',
        reason: 'late delivery',
        failure_reason: null,
        approved_at: '2026-02-01T10:00:00.000Z',
        settled_at: null,
      },
    ];

    render(<AdminTicketScreen />);
    fireEvent.press(screen.getByTestId('admin-refund-confirm-cash'));

    expect(mockConfirmCash).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByTestId('admin-refund-reason'), 'handed back at the door');
    fireEvent.press(screen.getByTestId('admin-refund-confirm-cash'));

    await waitFor(() => expect(mockConfirmCash).toHaveBeenCalled());
    expect(mockConfirmCash).toHaveBeenCalledWith({
      refundId: 'refund-cash',
      reason: 'handed back at the door',
    });
  });

  it('shows no refund controls for a ticket it cannot read', () => {
    mockState.ticket = null;

    render(<AdminTicketScreen />);

    expect(screen.getByTestId('admin-ticket-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('admin-refund-approve')).toBeNull();
  });

  it('marks the ticket read once it is open', async () => {
    render(<AdminTicketScreen />);

    await waitFor(() => expect(mockMarkRead).toHaveBeenCalled());
  });

  it('never marks a ticket read that it cannot read', async () => {
    mockState.ticket = null;

    render(<AdminTicketScreen />);
    await waitFor(() => expect(screen.getByTestId('admin-ticket-unavailable')).toBeTruthy());

    expect(mockMarkRead).not.toHaveBeenCalled();
  });
});
