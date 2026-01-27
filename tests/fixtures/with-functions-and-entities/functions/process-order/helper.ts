export function validateOrder(order: any): boolean {
  return order && typeof order.id === 'string';
}
