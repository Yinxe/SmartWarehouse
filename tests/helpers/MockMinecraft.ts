export class MockItemStack {
  readonly maxAmount = 64;
  nameTag?: string;

  constructor(
    readonly typeId: string,
    public amount: number
  ) {}

  clone(): MockItemStack {
    const cloned = new MockItemStack(this.typeId, this.amount);
    cloned.nameTag = this.nameTag;
    return cloned;
  }

  isStackableWith(other: MockItemStack): boolean {
    return this.typeId === other.typeId && this.nameTag === other.nameTag;
  }
}

export class MockContainer {
  failGetSlots = new Set<number>();
  failSetSlots = new Set<number>();
  failAddItem = false;

  constructor(
    readonly size: number,
    private readonly slots: (MockItemStack | undefined)[] = []
  ) {
    while (this.slots.length < size) this.slots.push(undefined);
  }

  get emptySlotsCount(): number {
    return this.slots.filter((slot) => !slot).length;
  }

  getItem(slot: number): MockItemStack | undefined {
    if (this.failGetSlots.has(slot)) throw new Error(`getItem failed at slot ${slot}`);
    return this.slots[slot]?.clone();
  }

  setItem(slot: number, item?: MockItemStack): void {
    if (this.failSetSlots.has(slot)) throw new Error(`setItem failed at slot ${slot}`);
    this.slots[slot] = item?.clone();
  }

  addItem(item: MockItemStack): MockItemStack | undefined {
    if (this.failAddItem) throw new Error("addItem failed");
    let remaining = item.amount;

    for (let slot = 0; slot < this.size; slot++) {
      const existing = this.slots[slot];
      if (!existing || !existing.isStackableWith(item) || existing.amount >= existing.maxAmount) continue;
      const moved = Math.min(remaining, existing.maxAmount - existing.amount);
      this.slots[slot] = new MockItemStack(existing.typeId, existing.amount + moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }

    for (let slot = 0; slot < this.size; slot++) {
      if (this.slots[slot]) continue;
      const moved = Math.min(remaining, item.maxAmount);
      this.slots[slot] = new MockItemStack(item.typeId, moved);
      remaining -= moved;
      if (remaining === 0) return undefined;
    }

    return new MockItemStack(item.typeId, remaining);
  }

  dump(): Array<{ typeId: string; amount: number } | undefined> {
    return this.slots.map((slot) => (slot ? { typeId: slot.typeId, amount: slot.amount } : undefined));
  }
}
