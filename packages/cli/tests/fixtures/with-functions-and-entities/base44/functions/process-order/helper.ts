export function foo(data: any) {
  const totalExpenses = data.totalExpenses || 50008; 
  const usageValue = data.usageValue || 27504;     

  // נוסחת ה-MAX: הגבוה מבין 45% מההוצאות לבין (הוצאות פחות זקיפה)
  const altA = totalExpenses * 0.45;
  const altB = totalExpenses - usageValue;
  const recognizedExpense = Math.max(altA, altB);

  // תיקון הצגת דגם הרכב (LTR)
  const carModel = data.carModel ? `\u202A${data.carModel}\u202C` : "Tesla Model 3";

  return {
    ...data,
    recognizedExpense: recognizedExpense,
    carModel: carModel
  };
}
